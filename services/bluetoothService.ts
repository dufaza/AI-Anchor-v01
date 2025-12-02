
import { SensorData, SensorType } from '../types';

// ===========================================================================
// CONFIGURATION TI SENSORTAG 2.0 (CC2650)
// ===========================================================================
const TI_UUIDS = {
    SERVICE: 'f000aa80-0451-4000-b000-000000000000',
    DATA:    'f000aa81-0451-4000-b000-000000000000',
    CONFIG:  'f000aa82-0451-4000-b000-000000000000',
    PERIOD:  'f000aa83-0451-4000-b000-000000000000'
};

// ===========================================================================
// CONFIGURATION STM32 SENSOR TILE BOX PRO
// ===========================================================================
const STM32_UUIDS = {
    SERVICE: '00000000-0001-11e1-9ab4-0002a5d5c51b',
    DATA:    '00000100-0001-11e1-ac36-0002a5d5c51b'
};
 
// ===========================================================================
// INTERNAL STATE
// ===========================================================================
let activeInterval: any = null;
let activeGattServer: BluetoothRemoteGATTServer | null = null;

// ===========================================================================
// DRIVER: SIMULATOR
// ===========================================================================
const startSimulator = (onData: (data: Partial<SensorData>) => void) => {
    let tick = 0;
    // HIGH FREQUENCY UPDATE: 10ms (100Hz) to match Recording Specs
    activeInterval = setInterval(() => {
        tick += 0.01; 
        const simPitch = Math.sin(tick) * 5 + (Math.random() * 0.5); 
        const simRoll = Math.sin(tick * 1.5) * 8 + (Math.random() * 0.5);
        const simYaw = Math.sin(tick * 0.2) * 15;

        // Simulate Raw Acceleration (mg) based on angles + noise
        const radP = simPitch * Math.PI / 180;
        const radR = simRoll * Math.PI / 180;
        const g = 1000; // 1000 mg
        
        // Basic kinematics for static/quasi-static case + noise
        const accX = g * Math.sin(radP) + (Math.random() * 20 - 10);
        const accY = -g * Math.sin(radR) * Math.cos(radP) + (Math.random() * 20 - 10);
        const accZ = g * Math.cos(radR) * Math.cos(radP) + (Math.random() * 20 - 10);

        onData({
            pitch: parseFloat(simPitch.toFixed(2)),
            roll: parseFloat(simRoll.toFixed(2)),
            yaw: parseFloat(simYaw.toFixed(2)),
            accX: parseFloat(accX.toFixed(2)),
            accY: parseFloat(accY.toFixed(2)),
            accZ: parseFloat(accZ.toFixed(2)),
            lastUpdate: Date.now(),
            isConnected: true,
            battery: 85,
            temperature: 24
        });
    }, 10); 

    return {
        id: 'SIM-001',
        name: 'Anchor Simulator'
    } as BluetoothDevice; 
};

// ===========================================================================
// DRIVER: TI SENSORTAG
// ===========================================================================
const parseTISensorData = (data: DataView): Partial<SensorData> => {
    try {
        let accOffset = 6; // Standard offset (Gyro 6 bytes + Accel)

        // Adaptive Parsing: 
        // If firmware shrinks packet when Gyro is disabled (Length 6 = Accel Only)
        if (data.byteLength === 6) {
            accOffset = 0;
        }
        // Standard packet size is 18 (Gyro(6) + Accel(6) + Mag(6))
        else if (data.byteLength >= 12) {
             accOffset = 6;
        } else {
             // Unknown packet format
             return {};
        }

        // TI uses Little Endian
        const rawAccX = data.getInt16(accOffset, true);
        const rawAccY = data.getInt16(accOffset + 2, true);
        const rawAccZ = data.getInt16(accOffset + 4, true);

        // Scale: Range 8G (default) -> 32768 / 8 = 4096 LSB/G.
        // Calc: (raw / 32768.0) * 8000.0 (mg)
        const scale = 8000.0 / 32768.0; 
        
        const accX = rawAccX * scale;
        const accY = rawAccY * scale;
        const accZ = rawAccZ * scale;

        // Calc Angles from Acc (Simple trig)
        const pitch = Math.atan2(rawAccY, Math.sqrt(rawAccX * rawAccX + rawAccZ * rawAccZ)) * 180.0 / Math.PI;
        const roll = Math.atan2(-rawAccX, rawAccZ) * 180.0 / Math.PI;

        let yaw = 0;
        // If Mag data exists (Offset 12), use it. But we disabled it, so it's likely 0 or missing.
        // We only check if packet is long enough (18 bytes) and config enables it (which we disabled).
        // For now, Yaw is 0 when Mag is disabled.

        return {
            pitch: parseFloat(pitch.toFixed(2)),
            roll: parseFloat(roll.toFixed(2)),
            yaw: parseFloat(yaw.toFixed(2)),
            accX: parseFloat(accX.toFixed(2)),
            accY: parseFloat(accY.toFixed(2)),
            accZ: parseFloat(accZ.toFixed(2)),
            lastUpdate: Date.now(),
            isConnected: true 
        };
    } catch (e) {
        console.error("TI Parse Error:", e);
        return {};
    }
};

const connectTI = async (onData: (data: Partial<SensorData>) => void, onDisconnect: () => void) => {
    if (!navigator.bluetooth) throw new Error("Bluetooth not supported");

    console.log("TI: Requesting Device...");
    const device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'CC2650' }, { namePrefix: 'SensorTag' }, { namePrefix: 'TI' }],
        optionalServices: [TI_UUIDS.SERVICE]
    });

    if (!device.gatt) throw new Error("No GATT Server");
    
    device.addEventListener('gattserverdisconnected', onDisconnect);
    console.log("TI: Connecting GATT...");
    const server = await device.gatt.connect();
    activeGattServer = server;

    console.log("TI: Getting Service...");
    const service = await server.getPrimaryService(TI_UUIDS.SERVICE);

    console.log("TI: Getting Characteristics...");
    const configChar = await service.getCharacteristic(TI_UUIDS.CONFIG);
    const periodChar = await service.getCharacteristic(TI_UUIDS.PERIOD);
    const dataChar = await service.getCharacteristic(TI_UUIDS.DATA);

    // ============================================================
    // ROBUST SEQUENCE (Modified for 10Hz Limit)
    // ============================================================

    // 1. Subscribe First (Most robust for iOS)
    console.log("TI: Starting Notifications...");
    await dataChar.startNotifications();
    dataChar.addEventListener('characteristicvaluechanged', (e: any) => {
        onData(parseTISensorData(e.target.value));
    });

    // 2. Enable Accelerometer ONLY (0x38)
    console.log("TI: Enabling Sensors (0x38)...");
    await configChar.writeValue(new Uint8Array([0x38, 0x00]));

    // 3. Wait for Wakeup (Essential)
    console.log("TI: Waiting for sensor wakeup (1s)...");
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 4. Write Period (0x0A = 100ms = 10Hz)
    // Hardware rejected 0x02 (20ms), so we fall back to 0x0A (Standard)
    console.log("TI: Setting Period to 100ms / 10Hz...");
    await periodChar.writeValue(new Uint8Array([0x0A]));
    
    // Note: Removed read verification to prevent crashing. 
    // We assume 100ms is accepted as it is the standard firmware limit.
    
    console.log("TI: Initialization Complete.");
    return device;
};


// ===========================================================================
// DRIVER: STM32 SENSOR TILE BOX PRO
// ===========================================================================

const parseSTM32Data = (data: DataView): Partial<SensorData> => {
    try {
        if (data.byteLength >= 14) {
             let qx = data.getFloat32(2, true);
             let qy = data.getFloat32(6, true);
             let qz = data.getFloat32(10, true);
             
             if (!Number.isFinite(qx) || !Number.isFinite(qy) || !Number.isFinite(qz)) return {};

             let sumSq = qx*qx + qy*qy + qz*qz;
             if (sumSq > 1.0) {
                 const norm = Math.sqrt(sumSq);
                 qx /= norm; qy /= norm; qz /= norm;
                 sumSq = 1.0; 
             }
             const qw = Math.sqrt(1.0 - sumSq);

             const sinr_cosp = 2 * (qw * qx + qy * qz);
             const cosr_cosp = 1 - 2 * (qx * qx + qy * qy);
             const roll = Math.atan2(sinr_cosp, cosr_cosp) * (180 / Math.PI);

             const sinp = 2 * (qw * qy - qz * qx);
             let pitch = 0;
             if (Math.abs(sinp) >= 1) pitch = (Math.PI / 2) * Math.sign(sinp) * (180 / Math.PI);
             else pitch = Math.asin(sinp) * (180 / Math.PI);

             const siny_cosp = 2 * (qw * qz + qx * qy);
             const cosy_cosp = 1 - 2 * (qy * qy + qz * qz);
             let yaw = Math.atan2(siny_cosp, cosy_cosp) * (180 / Math.PI);
             if (yaw < 0) yaw += 360;

             // Derive Static Gravity Vector (Acceleration in mg) from Euler Angles
             // Since we use fusion, we reconstruct the gravity vector as our best approx of accel in mg.
             const radP = pitch * Math.PI / 180;
             const radR = roll * Math.PI / 180;
             const g = 1000;
             
             const accX = g * Math.sin(radP);
             const accY = -g * Math.sin(radR) * Math.cos(radP);
             const accZ = g * Math.cos(radR) * Math.cos(radP);

             return {
                 pitch: parseFloat(pitch.toFixed(2)),
                 roll: parseFloat(roll.toFixed(2)),
                 yaw: parseFloat(yaw.toFixed(2)),
                 accX: parseFloat(accX.toFixed(2)),
                 accY: parseFloat(accY.toFixed(2)),
                 accZ: parseFloat(accZ.toFixed(2)),
                 lastUpdate: Date.now(),
                 isConnected: true
             };
        }

        return {};
    } catch (e) {
        console.error("STM32 Parse Error:", e);
        return {};
    }
};

const connectSTM32 = async (onData: (data: Partial<SensorData>) => void, onDisconnect: () => void) => {
    if (!navigator.bluetooth) throw new Error("Bluetooth not supported");

    const device = await navigator.bluetooth.requestDevice({
        filters: [
            { name: 'STB_PRO' },         
            { namePrefix: 'STB' },       
            { namePrefix: 'STM32' },     
            { namePrefix: 'BlueST' }     
        ],
        optionalServices: [STM32_UUIDS.SERVICE]
    });

    if (!device.gatt) throw new Error("No GATT Server");
    
    device.addEventListener('gattserverdisconnected', onDisconnect);
    const server = await device.gatt.connect();
    activeGattServer = server;

    const service = await server.getPrimaryService(STM32_UUIDS.SERVICE);
    
    const dataChar = await service.getCharacteristic(STM32_UUIDS.DATA);
    await dataChar.startNotifications();
    dataChar.addEventListener('characteristicvaluechanged', (e: any) => {
        onData(parseSTM32Data(e.target.value));
    });

    return device;
};
 

export const bluetoothService = {
    connect: async (
        type: SensorType, 
        onData: (data: Partial<SensorData>) => void,
        onDisconnect: () => void
    ): Promise<BluetoothDevice> => {
        
        if (activeInterval) clearInterval(activeInterval);
        if (activeGattServer && activeGattServer.connected) activeGattServer.disconnect();

        if (type === 'SIMULATOR') {
            return startSimulator(onData);
        } else if (type === 'TI_SENSORTAG') {
            return connectTI(onData, onDisconnect);
        } else if (type === 'STM32_TILEBOX') {
            return connectSTM32(onData, onDisconnect);
        } else {
            throw new Error(`Driver for ${type} not implemented yet.`);
        }
    },

    disconnect: (device: BluetoothDevice | null) => {
        if (activeInterval) {
            clearInterval(activeInterval);
            activeInterval = null;
        }
        if (activeGattServer && activeGattServer.connected) {
            activeGattServer.disconnect();
        }
        if (device && device.gatt && device.gatt.connected) {
            device.gatt.disconnect();
        }
    }
};
