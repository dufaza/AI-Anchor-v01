

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
// CONFIGURATION STM32 SENSOR TILE BOX PRO (BlueST Protocol)
// ===========================================================================
const STM32_UUIDS = {
    SERVICE: '00000000-0001-11e1-9ab4-0002a5d5c51b',
    
    // Feature: Sensor Fusion (Compact Quaternions) - Pour Pitch/Roll/Yaw Stable
    // Bitmask: 0x100
    CHAR_FUSION: '00000100-0001-11e1-ac36-0002a5d5c51b', 

    // Feature: Accelerometer (Raw Data) - Pour l'IA et l'enregistrement
    // Bitmask: 0x800000
    CHAR_ACCEL:  '00800000-0001-11e1-ac36-0002a5d5c51b',

    // NOTE: On ignore volontairement le Magnétomètre (00200000-...)
    // pour éviter les perturbations magnétiques de l'ancre.
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
            hasRawAccel: true, // Mock raw capability for simulator
            lastUpdate: Date.now(),
            isConnected: true,
            battery: 85,
            temperature: 24,
            qx: 0, qy: 0, qz: 0, qw: 1 // Dummy quats
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
            hasRawAccel: true, // TI data is derived from raw accel, so it counts
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
    
    // Robust Connection Loop
    let server: BluetoothRemoteGATTServer | null = null;
    let retries = 3;
    while (retries > 0 && !server) {
        try {
            server = await device.gatt.connect();
        } catch (error) {
            console.warn(`TI: GATT connect failed, retries left: ${retries-1}`, error);
            retries--;
            if (retries === 0) throw error;
            await new Promise(r => setTimeout(r, 1000)); // Wait 1s
        }
    }
    if (!server) throw new Error("GATT connection failed after retries");
    activeGattServer = server;

    console.log("TI: Getting Service...");
    const service = await server.getPrimaryService(TI_UUIDS.SERVICE);

    console.log("TI: Getting Characteristics...");
    const configChar = await service.getCharacteristic(TI_UUIDS.CONFIG);
    const periodChar = await service.getCharacteristic(TI_UUIDS.PERIOD);
    const dataChar = await service.getCharacteristic(TI_UUIDS.DATA);

    // 1. Subscribe First
    console.log("TI: Starting Notifications...");
    await dataChar.startNotifications();
    dataChar.addEventListener('characteristicvaluechanged', (e: any) => {
        onData(parseTISensorData(e.target.value));
    });

    // 2. Enable Accelerometer ONLY (0x38)
    console.log("TI: Enabling Sensors (0x38)...");
    await configChar.writeValue(new Uint8Array([0x38, 0x00]));

    // 3. Wait for Wakeup
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 4. Write Period (0x0A = 100ms = 10Hz)
    console.log("TI: Setting Period to 100ms / 10Hz...");
    await periodChar.writeValue(new Uint8Array([0x0A]));
    
    console.log("TI: Initialization Complete.");
    return device;
};


// ===========================================================================
// DRIVER: STM32 SENSOR TILE BOX PRO
// ===========================================================================

// Parse Fusion Data (Quaternions) for Smooth Pitch/Roll/Yaw
const parseSTM32Fusion = (data: DataView): Partial<SensorData> => {
    try {
        // Expecting [Timestamp(2)] + [Qx(4)] + [Qy(4)] + [Qz(4)] = 14 bytes
        if (data.byteLength >= 14) {
             let qx = data.getFloat32(2, true);
             let qy = data.getFloat32(6, true);
             let qz = data.getFloat32(10, true);
             
             // Validate inputs
             if (!Number.isFinite(qx) || !Number.isFinite(qy) || !Number.isFinite(qz)) return {};

             // Calculate W component (unit quaternion constraint)
             let sumSq = qx*qx + qy*qy + qz*qz;
             
             // CRITICAL FIX: Normalization Logic
             // If sumSq > 1.0 (noise), we MUST normalize the vector (x,y,z) first.
             // Setting W=0 abruptly when sumSq > 1.0 (previous logic) caused Pitch to zero out
             // because w=0 implies a specific 180 rotation that nullified the Pitch term.
             if (sumSq > 1.0) {
                 const norm = Math.sqrt(sumSq);
                 if (norm > 0) {
                    qx /= norm;
                    qy /= norm;
                    qz /= norm;
                 }
                 // After normalizing x,y,z to magnitude 1, w must be 0
                 sumSq = 1.0;
             }
             
             let qw = Math.sqrt(1.0 - sumSq);

             // Euler Angles (Tait-Bryan Z-Y-X sequence)
             // Roll (x-axis), Pitch (y-axis), Yaw (z-axis)
             
             // Roll (x-axis rotation)
             // atan2(2(w*x + y*z), 1 - 2(x^2 + y^2))
             const t0 = 2.0 * (qw * qx + qy * qz);
             const t1 = 1.0 - 2.0 * (qx*qx + qy*qy);
             const roll = Math.atan2(t0, t1) * (180.0 / Math.PI);
             
             // Pitch (y-axis rotation)
             // asin(2(w*y - z*x))
             let t2 = 2.0 * (qw * qy - qz * qx);
             // Clamp for safety to avoid NaN from asin > 1.0
             if (t2 > 1.0) t2 = 1.0;
             if (t2 < -1.0) t2 = -1.0;
             const pitch = Math.asin(t2) * (180.0 / Math.PI);
             
             // Yaw (z-axis rotation)
             // atan2(2(w*z + x*y), 1 - 2(y^2 + z^2))
             const t3 = 2.0 * (qw * qz + qx * qy);
             const t4 = 1.0 - 2.0 * (qy*qy + qz*qz);
             let yaw = Math.atan2(t3, t4) * (180.0 / Math.PI);
             
             // Normalize Yaw 0-360
             if (yaw < 0) yaw += 360;

             // Return with safety defaults to prevent NaN
             return {
                 pitch: Number.isFinite(pitch) ? parseFloat(pitch.toFixed(2)) : 0,
                 roll: Number.isFinite(roll) ? parseFloat(roll.toFixed(2)) : 0,
                 yaw: Number.isFinite(yaw) ? parseFloat(yaw.toFixed(2)) : 0,
                 isConnected: true,
                 // Send Raw Quaternions for Debugging
                 qx: parseFloat(qx.toFixed(3)),
                 qy: parseFloat(qy.toFixed(3)),
                 qz: parseFloat(qz.toFixed(3)),
                 qw: parseFloat(qw.toFixed(3))
             };
        }
        return {};
    } catch (e) {
        console.error("STM32 Fusion Parse Error:", e);
        return {};
    }
};

// Parse Raw Accelerometer (Int16) for AI/Logging
const parseSTM32Accel = (data: DataView): Partial<SensorData> => {
    try {
        // Expecting [Timestamp(2)] + [AccX(2)] + [AccY(2)] + [AccZ(2)] = 8 bytes
        if (data.byteLength >= 8) {
             // Read Int16 values (Little Endian)
             const rawX = data.getInt16(2, true);
             const rawY = data.getInt16(4, true);
             const rawZ = data.getInt16(6, true);
             
             // Conversion to mg (milli-g). 
             // Default sensitivity for +/- 2g is usually ~0.061 mg/LSB or similar.
             // For general AI logging, we can log the Int16 or a roughly scaled mg.
             // We'll apply a standard scaling for visualization.
             const SENSITIVITY = 0.061; 
             
             return {
                 accX: parseFloat((rawX * SENSITIVITY).toFixed(2)),
                 accY: parseFloat((rawY * SENSITIVITY).toFixed(2)),
                 accZ: parseFloat((rawZ * SENSITIVITY).toFixed(2)),
                 hasRawAccel: true, // Flag this as valid raw data for logging
                 lastUpdate: Date.now(),
                 isConnected: true
             };
        }
        return {};
    } catch (e) {
        console.error("STM32 Accel Parse Error:", e);
        return {};
    }
};

const connectSTM32 = async (onData: (data: Partial<SensorData>) => void, onDisconnect: () => void) => {
    if (!navigator.bluetooth) throw new Error("Bluetooth not supported");

    console.log("STM32: Scanning...");
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
    console.log("STM32: Connecting GATT...");
    
    // Robust Connection Loop (Retry Mechanism)
    let server: BluetoothRemoteGATTServer | null = null;
    let retries = 3;
    while (retries > 0 && !server) {
        try {
            server = await device.gatt.connect();
        } catch (error) {
            console.warn(`STM32: GATT connect failed, retries left: ${retries-1}`, error);
            retries--;
            if (retries === 0) throw error;
            await new Promise(r => setTimeout(r, 1000)); // Wait 1s
        }
    }
    if (!server) throw new Error("GATT connection failed after retries");
    activeGattServer = server;

    console.log("STM32: Getting Primary Service...");
    const service = await server.getPrimaryService(STM32_UUIDS.SERVICE);
    
    // --- 1. SETUP FUSION (Quaternions for UI) ---
    try {
        console.log("STM32: Subscribing to Sensor Fusion (0x100)...");
        const fusionChar = await service.getCharacteristic(STM32_UUIDS.CHAR_FUSION);
        await fusionChar.startNotifications();
        fusionChar.addEventListener('characteristicvaluechanged', (e: any) => {
            onData(parseSTM32Fusion(e.target.value));
        });
    } catch (err) {
        console.warn("STM32: Could not subscribe to Fusion.", err);
    }

    // DELAY FOR IOS STABILITY (Subscribing too fast can fail on iPhone)
    await new Promise(resolve => setTimeout(resolve, 500));

    // --- 2. SETUP RAW ACCELEROMETER (For AI Logging) ---
    try {
        console.log("STM32: Subscribing to Raw Accel (0x800000)...");
        // Note: This UUID depends on firmware. If standard Pro firmware, this is Accel.
        const accelChar = await service.getCharacteristic(STM32_UUIDS.CHAR_ACCEL);
        await accelChar.startNotifications();
        accelChar.addEventListener('characteristicvaluechanged', (e: any) => {
            onData(parseSTM32Accel(e.target.value));
        });
    } catch (err) {
        console.warn("STM32: Could not subscribe to Raw Accel. Logging might be empty.", err);
    }

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