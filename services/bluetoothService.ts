

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
    SERVICE_EXT: '00000000-000e-11e1-9ab4-0002a5d5c51b',
    
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

const getBluetoothErrorName = (error: any) => {
    return error?.name || (typeof error === 'number' ? 'NumericBluetoothError' : 'BluetoothError');
};

const getBluetoothErrorMessage = (error: any) => {
    if (error?.message) return error.message;
    if (typeof error === 'string') return error;
    if (typeof error === 'number') return String(error);
    try {
        return JSON.stringify(error) || String(error);
    } catch {
        return String(error);
    }
};

const enrichBluetoothError = (
    error: any,
    step: string,
    device: BluetoothDevice | null,
    serviceUuid: string | null = null,
    characteristicUuid: string | null = null,
    availableCharacteristics: string | null = null
) => {
    if (error?.bluetoothStep) return error;

    const errorName = getBluetoothErrorName(error);
    const errorMessage = getBluetoothErrorMessage(error);
    const deviceName = device?.name || 'Unavailable';
    const deviceId = device?.id || 'Unavailable';
    const attemptedServiceUuid = serviceUuid || 'Unavailable';
    const attemptedCharacteristicUuid = characteristicUuid || 'Unavailable';
    const discoveredCharacteristics = availableCharacteristics || 'Unavailable';
    const enriched = new Error(
        [
            'STM32 Bluetooth connection failed',
            `step: ${step}`,
            `error.name: ${errorName}`,
            `error.message: ${errorMessage}`,
            `device.name: ${deviceName}`,
            `device.id: ${deviceId}`,
            `service.uuid: ${attemptedServiceUuid}`,
            `characteristic.uuid: ${attemptedCharacteristicUuid}`,
            `available.characteristics:\n${discoveredCharacteristics}`
        ].join('\n')
    );

    enriched.name = errorName;
    (enriched as any).bluetoothStep = step;
    (enriched as any).originalErrorName = errorName;
    (enriched as any).originalErrorMessage = errorMessage;
    (enriched as any).deviceName = deviceName;
    (enriched as any).deviceId = deviceId;
    (enriched as any).serviceUuid = attemptedServiceUuid;
    (enriched as any).characteristicUuid = attemptedCharacteristicUuid;
    (enriched as any).availableCharacteristics = discoveredCharacteristics;
    (enriched as any).cause = error;

    return enriched;
};

const logSTM32Characteristics = async (service: BluetoothRemoteGATTService, label: string) => {
    console.log('=== STM32 CHARACTERISTICS ===');
    console.log(`SERVICE_LABEL=${label}`);
    console.log(`SERVICE_UUID=${service.uuid}`);
    try {
        const characteristics = await (service as any).getCharacteristics();
        if (!characteristics || characteristics.length === 0) {
            console.warn(`STM32: No characteristics discovered for ${label} service=${service.uuid}`);
            return `SERVICE_LABEL=${label}\nSERVICE_UUID=${service.uuid}\nNo characteristics discovered`;
        }

        const characteristicLines = characteristics.map((characteristic: BluetoothRemoteGATTCharacteristic) => (
            [
                `SERVICE_LABEL=${label}`,
                `SERVICE_UUID=${service.uuid}`,
                'Characteristic:',
                `UUID=${characteristic.uuid}`,
                `READ=${characteristic.properties.read}`,
                `WRITE=${characteristic.properties.write}`,
                `NOTIFY=${characteristic.properties.notify}`,
                `INDICATE=${characteristic.properties.indicate}`
            ].join('\n')
        ));

        characteristics.forEach((characteristic: BluetoothRemoteGATTCharacteristic) => {
            console.log(
                [
                    'Characteristic:',
                    `UUID=${characteristic.uuid}`,
                    `READ=${characteristic.properties.read}`,
                    `WRITE=${characteristic.properties.write}`,
                    `NOTIFY=${characteristic.properties.notify}`,
                    `INDICATE=${characteristic.properties.indicate}`
                ].join('\n')
            );
        });
        return characteristicLines.join('\n\n');
    } catch (error) {
        console.warn(`STM32: Could not list characteristics for ${label} service=${service.uuid}`, error);
        return `SERVICE_LABEL=${label}\nSERVICE_UUID=${service.uuid}\nCould not list characteristics: ${getBluetoothErrorName(error)} ${getBluetoothErrorMessage(error)}`;
    }
};

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
    console.log("TI: Enabling Sensors (0x38: Acc+Gyro+Mag off)...");
    await configChar.writeValue(new Uint8Array([0x38, 0x00])); 

    // 3. Set Period (10 = 100ms)
    console.log("TI: Setting Period...");
    await periodChar.writeValue(new Uint8Array([0x0A])); 

    return device;
};


// ===========================================================================
// DRIVER: STM32 SENSOR TILE BOX PRO
// ===========================================================================

// Helper: Quaternions to Euler Angles
// Input: qx, qy, qz, qw (normalized)
// Output: Pitch, Roll, Yaw (Degrees)
const quatToEuler = (x: number, y: number, z: number, w: number) => {
    const radToDeg = 180.0 / Math.PI;

    // Pitch (Y-axis rotation)
    // Singularity check at +/- 90 degrees
    const sinP = 2.0 * (w * y - z * x);
    let pitch = 0;
    if (Math.abs(sinP) >= 1) {
        // Use 90 degrees if out of range
        pitch = Math.sign(sinP) * (Math.PI / 2); 
    } else {
        pitch = Math.asin(sinP);
    }

    // Roll (X-axis)
    const roll = Math.atan2(2.0 * (w * x + y * z), 1.0 - 2.0 * (x * x + y * y));

    // Yaw (Z-axis)
    const yaw = Math.atan2(2.0 * (w * z + x * y), 1.0 - 2.0 * (y * y + z * z));

    return {
        pitch: pitch * radToDeg,
        roll: roll * radToDeg,
        yaw: yaw * radToDeg
    };
};

const parseSTM32Fusion = (data: DataView): Partial<SensorData> => {
    // Standard BlueST format for Feature "Midi_Quaternions" (0x00000100)
    // Byte 0-1: Timestamp (UInt16)
    // Byte 2-5: Float32 X
    // Byte 6-9: Float32 Y
    // Byte 10-13: Float32 Z
    // (Sometimes W is missing, we must calculate it)
    
    // Check length (min 14 bytes for 3 floats + 2 TS)
    if (data.byteLength < 14) return {};

    // Get Raw Quaternions Components (Little Endian)
    let x = data.getFloat32(2, true);
    let y = data.getFloat32(6, true);
    let z = data.getFloat32(10, true);
    
    // Calculate W
    // Quaternions must be normalized: x^2 + y^2 + z^2 + w^2 = 1
    // w = sqrt(1 - (x^2 + y^2 + z^2))
    const sumSq = x*x + y*y + z*z;
    let w = 0;

    if (sumSq < 1.0) {
        w = Math.sqrt(1.0 - sumSq);
    } else {
        // FIX: Soft Normalization for Sensor Noise
        // Instead of setting w=0 (which causes Gimbal Lock at 0-pitch),
        // we scale x,y,z down to fit the unit sphere.
        const norm = Math.sqrt(sumSq);
        // Avoid division by zero
        if (norm > 0) {
            const scale = 1.0 / norm;
            x *= scale;
            y *= scale;
            z *= scale;
            // After scaling, x^2+y^2+z^2 = 1, so w = 0
            w = 0; 
        }
    }

    // Use robust matrix conversion
    const angles = quatToEuler(x, y, z, w);

    return {
        pitch: parseFloat(angles.pitch.toFixed(2)),
        roll: parseFloat(angles.roll.toFixed(2)),
        yaw: parseFloat(angles.yaw.toFixed(2)),
        // Send Raw Quats for Debug
        qx: x, qy: y, qz: z, qw: w,
        lastUpdate: Date.now(),
        isConnected: true
    };
};

const parseSTM32Accel = (data: DataView): Partial<SensorData> => {
    // Feature 0x00800000 (Accelerometer)
    // Byte 0-1: Timestamp
    // Byte 2-3: AccX (Int16) - mg
    // Byte 4-5: AccY (Int16) - mg
    // Byte 6-7: AccZ (Int16) - mg
    if (data.byteLength < 8) return {};

    const accX = data.getInt16(2, true);
    const accY = data.getInt16(4, true);
    const accZ = data.getInt16(6, true);

    return {
        accX: accX,
        accY: accY,
        accZ: accZ,
        hasRawAccel: true // Valid Raw Data flag
    };
};

const connectSTM32 = async (onData: (data: Partial<SensorData>) => void, onDisconnect: () => void) => {
    if (!navigator.bluetooth) throw new Error("Bluetooth not supported");

    let step = 'requestDevice';
    let device: BluetoothDevice | null = null;
    let serviceUuid: string | null = null;
    let characteristicUuid: string | null = null;
    let availableCharacteristics: string | null = null;

    try {
        console.log("STM32: Requesting Device...");
        // FIX: Reverting to Name-Based Filters ONLY.
        // Filtering by Service UUID (STM32_UUIDS.SERVICE) often hides the device on iOS 
        // because the SensorTile doesn't always advertise the UUID in the public packet.
        device = await navigator.bluetooth.requestDevice({
            filters: [
                { namePrefix: 'BC' },   // Box Connect (often BCST...)
                { namePrefix: 'ST' },   // STMicroelectronics
                { namePrefix: 'Sen' },  // SensorTile
                { namePrefix: 'Blue' }, // BlueMS
                { namePrefix: 'BLE' },
                { namePrefix: 'BLEMCL' },
                { namePrefix: 'BLEMLC' },
                { namePrefix: 'STM32' },
                { namePrefix: 'Sensor' },
                { namePrefix: 'SensorBox' },
                { namePrefix: 'SensorTile' },
                { namePrefix: 'STBOX' },
                { namePrefix: 'HSD' },
                { namePrefix: 'HSD2v31' }    // DT_ 
            ],
            // CRITICAL: We MUST list the service here to access it later, 
            // even if we don't filter by it during discovery.
            optionalServices: [STM32_UUIDS.SERVICE, STM32_UUIDS.SERVICE_EXT]
        });
        console.log(`STM32: Device selected: device.name=${device.name || 'Unavailable'}, device.id=${device.id || 'Unavailable'}`);

        if (!device.gatt) throw new Error("No GATT Server");
        
        device.addEventListener('gattserverdisconnected', onDisconnect);
        console.log("STM32: Connecting GATT...");
        
        // Robust Connection Loop (Retry logic)
        step = 'gatt.connect';
        let server: BluetoothRemoteGATTServer | null = null;
        let retries = 3;
        while (retries > 0 && !server) {
            try {
                server = await device.gatt.connect();
            } catch (error) {
                console.warn(`STM32: GATT connect failed, retries left: ${retries-1}`, error);
                retries--;
                if (retries === 0) throw error;
                await new Promise(r => setTimeout(r, 1000));
            }
        }
        if (!server) throw new Error("GATT connection failed");
        activeGattServer = server;
        console.log("STM32: GATT connected OK");

        console.log(`STM32: Getting primary service ${STM32_UUIDS.SERVICE}...`);
        step = 'getPrimaryService';
        serviceUuid = STM32_UUIDS.SERVICE;
        let service: BluetoothRemoteGATTService | null = null;
        try {
            service = await server.getPrimaryService(STM32_UUIDS.SERVICE);
            console.log(`STM32: Service found: ${STM32_UUIDS.SERVICE}`);
            availableCharacteristics = await logSTM32Characteristics(service, 'PRIMARY');
            try {
                const extensionService = await server.getPrimaryService(STM32_UUIDS.SERVICE_EXT);
                console.log(`STM32: Extension service found: ${STM32_UUIDS.SERVICE_EXT}`);
                const extensionCharacteristics = await logSTM32Characteristics(extensionService, 'EXTENSION');
                availableCharacteristics = [availableCharacteristics, extensionCharacteristics].filter(Boolean).join('\n\n');
            } catch (extensionServiceError) {
                const enrichedExtension = enrichBluetoothError(extensionServiceError, step, device, STM32_UUIDS.SERVICE_EXT, characteristicUuid, availableCharacteristics);
                console.warn(enrichedExtension.message, extensionServiceError);
            }
        } catch (primaryServiceError) {
            const enrichedPrimary = enrichBluetoothError(primaryServiceError, step, device, serviceUuid, characteristicUuid, availableCharacteristics);
            console.warn(enrichedPrimary.message, primaryServiceError);
            console.log(`STM32: Primary service failed, trying extension service ${STM32_UUIDS.SERVICE_EXT}...`);
            serviceUuid = STM32_UUIDS.SERVICE_EXT;
            service = await server.getPrimaryService(STM32_UUIDS.SERVICE_EXT);
            console.log(`STM32: Service found: ${STM32_UUIDS.SERVICE_EXT}`);
            availableCharacteristics = await logSTM32Characteristics(service, 'EXTENSION');
        }

        console.log("STM32: Getting Characteristics...");
        // 1. Subscribe to FUSION (Quaternions)
        step = 'getCharacteristic';
        characteristicUuid = STM32_UUIDS.CHAR_FUSION;
        let fusionChar: BluetoothRemoteGATTCharacteristic | null = null;
        let accelChar: BluetoothRemoteGATTCharacteristic | null = null;
        try {
            fusionChar = await service.getCharacteristic(STM32_UUIDS.CHAR_FUSION);
            console.log(`STM32: Characteristic found: ${STM32_UUIDS.CHAR_FUSION}`);
        } catch (fusionError) {
            const enrichedFusion = enrichBluetoothError(fusionError, step, device, serviceUuid, characteristicUuid, availableCharacteristics);
            console.warn(enrichedFusion.message, fusionError);
            console.log(`STM32: Fusion characteristic failed, trying accel characteristic ${STM32_UUIDS.CHAR_ACCEL}...`);
            characteristicUuid = STM32_UUIDS.CHAR_ACCEL;
            try {
                accelChar = await service.getCharacteristic(STM32_UUIDS.CHAR_ACCEL);
                console.log(`STM32: Characteristic found: ${STM32_UUIDS.CHAR_ACCEL}`);
            } catch (accelError) {
                const enrichedAccel = enrichBluetoothError(accelError, step, device, serviceUuid, characteristicUuid, availableCharacteristics);
                console.error("STM32: No expected STM32 characteristic found", enrichedAccel.message, accelError);
                throw enrichedAccel;
            }
        }

        if (fusionChar) {
            console.log("STM32: Subscribing to FUSION...");
            step = 'startNotifications';
            characteristicUuid = STM32_UUIDS.CHAR_FUSION;
            try {
                await fusionChar.startNotifications();
                console.log(`STM32: Notifications started on ${STM32_UUIDS.CHAR_FUSION}`);
            } catch (notificationError) {
                throw enrichBluetoothError(notificationError, step, device, serviceUuid, characteristicUuid, availableCharacteristics);
            }
            fusionChar.addEventListener('characteristicvaluechanged', (e: any) => {
                onData(parseSTM32Fusion(e.target.value));
            });
        }

        // 2. Subscribe to ACCEL (Raw Data) - with delay for iOS stability
        await new Promise(r => setTimeout(r, 500)); // 500ms delay
        
        try {
            if (!accelChar) {
                step = 'getCharacteristic';
                characteristicUuid = STM32_UUIDS.CHAR_ACCEL;
                accelChar = await service.getCharacteristic(STM32_UUIDS.CHAR_ACCEL);
                console.log(`STM32: Characteristic found: ${STM32_UUIDS.CHAR_ACCEL}`);
            }
            console.log("STM32: Subscribing to ACCEL...");
            step = 'startNotifications';
            characteristicUuid = STM32_UUIDS.CHAR_ACCEL;
            try {
                await accelChar.startNotifications();
                console.log(`STM32: Notifications started on ${STM32_UUIDS.CHAR_ACCEL}`);
            } catch (notificationError) {
                throw enrichBluetoothError(notificationError, step, device, serviceUuid, characteristicUuid, availableCharacteristics);
            }
            accelChar.addEventListener('characteristicvaluechanged', (e: any) => {
                onData(parseSTM32Accel(e.target.value));
            });
            console.log("STM32: ACCEL Subscribed OK");
        } catch (e) {
            const enrichedAccelOptional = enrichBluetoothError(e, step, device, serviceUuid, characteristicUuid, availableCharacteristics);
            if (!fusionChar) {
                console.error("STM32: No expected STM32 characteristic found", enrichedAccelOptional.message, e);
                throw enrichedAccelOptional;
            }
            console.warn("STM32: Could not subscribe to Raw Accel (Firmware config issue?)", enrichedAccelOptional.message, e);
            // Do not crash, just continue without raw data
        }

        return device;
    } catch (error) {
        const enriched = enrichBluetoothError(error, step, device, serviceUuid, characteristicUuid, availableCharacteristics);
        console.error(enriched.message, error);
        throw enriched;
    }
};


// ===========================================================================
// MAIN EXPORT
// ===========================================================================
export const bluetoothService = {
    connect: async (type: SensorType, onData: (data: Partial<SensorData>) => void, onDisconnect: () => void) => {
        if (activeInterval) clearInterval(activeInterval);
        if (activeGattServer && activeGattServer.connected) {
            activeGattServer.disconnect();
        }

        switch (type) {
            case 'SIMULATOR':
                return startSimulator(onData);
            case 'TI_SENSORTAG':
                return connectTI(onData, onDisconnect);
            case 'STM32_TILEBOX':
                return connectSTM32(onData, onDisconnect);
            default:
                throw new Error("Unknown Sensor Type");
        }
    },
 
    disconnect: (device: BluetoothDevice | null) => {
        if (activeInterval) clearInterval(activeInterval);
        if (device && device.gatt && device.gatt.connected) {
            device.gatt.disconnect();
        }
        activeGattServer = null;
    }
};