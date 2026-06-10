

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
// CONFIGURATION STM32 SENSOR TILE / SENSORBOXPRO (BlueST Features)
// ===========================================================================
const STM32_BLE_NAME_PREFIXES = ['BLEMCL'];
const STM32_FEATURES_SERVICE_UUID = '00000000-0001-11e1-9ab4-0002a5d5c51b';
const STM32_CHAR_INERTIAL = '00e00000-0001-11e1-ac36-0002a5d5c51b';
const STM32_CHAR_MLC = '0000000f-0002-11e1-ac36-0002a5d5c51b';
const STM32_CHAR_FSM = '00000010-0002-11e1-ac36-0002a5d5c51b';
const STM32_CHAR_ACTIVITY = '00000010-0001-11e1-ac36-0002a5d5c51b';
const STM32_CHAR_EXT_CONFIG = '00000014-0002-11e1-ac36-0002a5d5c51b';

const STM32_OPTIONAL_NOTIFICATION_CHARS = [
    STM32_CHAR_MLC,
    STM32_CHAR_FSM,
    STM32_CHAR_ACTIVITY
];

const STM32_KNOWN_CHARACTERISTICS = [
    STM32_CHAR_INERTIAL,
    STM32_CHAR_MLC,
    STM32_CHAR_FSM,
    STM32_CHAR_ACTIVITY,
    STM32_CHAR_EXT_CONFIG
];
 
// ===========================================================================
// INTERNAL STATE
// ===========================================================================
let activeInterval: any = null;
let activeGattServer: BluetoothRemoteGATTServer | null = null;
let recentSTM32RawNotificationLogs: string[] = [];
let lastSTM32NotificationAtByUuid: Record<string, number> = {};
let stm32MLCPacketCount = 0;

const emitBluetoothDebug = (detail: any) => {
    window.dispatchEvent(new CustomEvent('smartanchor-ble-debug', { detail }));
};

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
    const rawNotificationLogs = recentSTM32RawNotificationLogs.length > 0 ? recentSTM32RawNotificationLogs.join('\n\n') : 'Unavailable';
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
            `available.characteristics:\n${discoveredCharacteristics}`,
            `raw.notifications:\n${rawNotificationLogs}`
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
    (enriched as any).rawNotificationLogs = rawNotificationLogs;
    (enriched as any).cause = error;

    return enriched;
};

const formatSTM32RawPayload = (uuid: string, data: DataView, intervalMs: number | null, estimatedHz: number | null) => {
    const bytes = Array.from({ length: data.byteLength }, (_, index) => data.getUint8(index));
    const hex = bytes.map(byte => byte.toString(16).padStart(2, '0')).join(' ');
    const decimal = bytes.join(' ');
    return [
        'STM32 RAW NOTIFICATION',
        `characteristic.uuid=${uuid}`,
        `byteLength=${data.byteLength}`,
        `payload.hex=${hex}`,
        `payload.decimal=${decimal}`,
        `interval_ms=${intervalMs !== null ? intervalMs : 'first'}`,
        `estimated_hz=${estimatedHz !== null ? estimatedHz.toFixed(2) : 'n/a'}`
    ].join('\n');
};

const getSTM32RawDebug = (uuid: string, data: DataView) => {
    const bytes = Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    const toHex = (values: number[]) => values.map(byte => byte.toString(16).padStart(2, '0')).join(' ');

    return {
        rawSourceUuid: uuid,
        rawByteLength: data.byteLength,
        rawHexExact: toHex(bytes),
        rawBytes_0_7: toHex(bytes.slice(0, 8)),
        rawBytes_8_13: toHex(bytes.slice(8, 14)),
        rawBytes_14_19: toHex(bytes.slice(14, 20))
    };
};

const logSTM32RawNotification = (uuid: string, data: DataView, rawDebug = getSTM32RawDebug(uuid, data)) => {
    const now = Date.now();
    const previousAt = lastSTM32NotificationAtByUuid[uuid] || null;
    const intervalMs = previousAt ? now - previousAt : null;
    const estimatedHz = intervalMs && intervalMs > 0 ? 1000 / intervalMs : null;
    lastSTM32NotificationAtByUuid[uuid] = now;
    const logEntry = formatSTM32RawPayload(uuid, data, intervalMs, estimatedHz);
    const bytes = Array.from({ length: data.byteLength }, (_, index) => data.getUint8(index));
    const hex = bytes.map(byte => byte.toString(16).padStart(2, '0')).join(' ');
    recentSTM32RawNotificationLogs.push(logEntry);
    recentSTM32RawNotificationLogs = recentSTM32RawNotificationLogs.slice(-10);
    console.log(logEntry);
    emitBluetoothDebug({
        type: 'packet',
        uuid,
        byteLength: data.byteLength,
        hex,
        ...rawDebug,
        intervalMs,
        estimatedHz: estimatedHz !== null ? estimatedHz.toFixed(2) : null
    });
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

const parseSTM32Inertial = (data: DataView): Partial<SensorData> => {
    const result: Partial<SensorData> = {
        lastUpdate: Date.now(),
        isConnected: true
    };
    (result as any).stm32PacketLength = data.byteLength;

    if (data.byteLength >= 8) {
        const accX = data.getInt16(2, true);
        const accY = data.getInt16(4, true);
        const accZ = data.getInt16(6, true);
        const pitch = Math.atan2(accY, Math.sqrt(accX * accX + accZ * accZ)) * 180 / Math.PI;
        const roll = Math.atan2(-accX, accZ) * 180 / Math.PI;
        const yaw = 0;

        result.pitch = parseFloat(pitch.toFixed(2));
        result.roll = parseFloat(roll.toFixed(2));
        result.yaw = yaw;
        result.accX = accX;
        result.accY = accY;
        result.accZ = accZ;
        result.hasRawAccel = true;
    }

    if (data.byteLength >= 14) {
        const gyroRawX = data.getInt16(8, true);
        const gyroRawY = data.getInt16(10, true);
        const gyroRawZ = data.getInt16(12, true);

        result.gyroX = gyroRawX / 10;
        result.gyroY = gyroRawY / 10;
        result.gyroZ = gyroRawZ / 10;
        (result as any).stm32GyroRawX = gyroRawX;
        (result as any).stm32GyroRawY = gyroRawY;
        (result as any).stm32GyroRawZ = gyroRawZ;
    }

    if (data.byteLength >= 20) {
        result.magX = data.getInt16(14, true);
        result.magY = data.getInt16(16, true);
        result.magZ = data.getInt16(18, true);
    }

    console.log("STM32 decoded inertial data", result);
    return result;
};

const getCharacteristicWithRetry = async (
    service: BluetoothRemoteGATTService,
    uuid: string,
    maxAttempts = 5,
    delayMs = 1000
) => {
    let lastError: any = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            console.log(`STM32 getCharacteristic attempt ${attempt}/${maxAttempts}: ${uuid}`);
            return await service.getCharacteristic(uuid);
        } catch (error) {
            lastError = error;
            console.warn(`STM32 getCharacteristic failed attempt ${attempt}/${maxAttempts}: ${uuid}`, error);
            if (attempt < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
    }

    throw lastError;
};

const getPrimaryServiceWithRetry = async (
    server: BluetoothRemoteGATTServer,
    uuid: string,
    maxAttempts = 5,
    delayMs = 1500
) => {
    let lastError: any = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            console.log(`STM32 getPrimaryService START ${attempt}/${maxAttempts}: ${uuid}`);
            const service = await Promise.race([
                server.getPrimaryService(uuid),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error("getPrimaryService timeout")), 3000)
                )
            ]);
            console.log(`STM32 getPrimaryService OK ${attempt}/${maxAttempts}: ${uuid}`);
            return service;
        } catch (error) {
            lastError = error;
            const errorMessage = getBluetoothErrorMessage(error);
            const status = errorMessage === "getPrimaryService timeout" ? "TIMEOUT" : "FAILED";
            console.warn(`STM32 getPrimaryService ${status} ${attempt}/${maxAttempts}: ${getBluetoothErrorName(error)} ${errorMessage}`);
            if (attempt < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
    }

    throw lastError;
};

const logSTM32StepFailed = (stepNumber: number, error: any) => {
    console.error(`STM32 STEP ${stepNumber} FAILED:`);
    console.error(getBluetoothErrorName(error));
    console.error(getBluetoothErrorMessage(error));
};

const subscribeSTM32Characteristic = async (
    service: BluetoothRemoteGATTService,
    uuid: string,
    device: BluetoothDevice,
    subscribedUuids: string[],
    onData?: (data: Partial<SensorData>) => void
) => {
    console.log(`STM32 getCharacteristic start ${uuid}`);
    if (uuid === STM32_CHAR_INERTIAL) {
        console.log("STM32 STEP 4 START");
    }
    let characteristic: BluetoothRemoteGATTCharacteristic;
    try {
        characteristic = await getCharacteristicWithRetry(service, uuid);
        if (uuid === STM32_CHAR_INERTIAL) {
            console.log("STM32 STEP 4 OK");
        }
    } catch (error) {
        if (uuid === STM32_CHAR_INERTIAL) {
            logSTM32StepFailed(4, error);
        }
        throw error;
    }
    console.log(`STM32 getCharacteristic OK ${uuid}`);

    if (!characteristic.properties.notify) {
        throw new Error(`STM32 characteristic does not support notify: ${uuid}`);
    }

    console.log(`STM32 startNotifications start ${uuid}`);
    if (uuid === STM32_CHAR_INERTIAL) {
        console.log("STM32 STEP 5 START");
    }
    try {
        await characteristic.startNotifications();
        if (uuid === STM32_CHAR_INERTIAL) {
            console.log("STM32 STEP 5 OK");
        }
    } catch (error) {
        if (uuid === STM32_CHAR_INERTIAL) {
            logSTM32StepFailed(5, error);
        }
        throw error;
    }
    console.log(`STM32 startNotifications OK ${uuid}`);

    subscribedUuids.push(uuid);
    characteristic.addEventListener('characteristicvaluechanged', (e: any) => {
        const value = e.target.value;
        const rawDebug = getSTM32RawDebug(uuid, value);
        console.log("[STM32 RAW BLE]", {
            uuid,
            rawByteLength: rawDebug.rawByteLength,
            rawHexExact: rawDebug.rawHexExact,
            b0_7: rawDebug.rawBytes_0_7,
            b8_13: rawDebug.rawBytes_8_13,
            b14_19: rawDebug.rawBytes_14_19
        });
        logSTM32RawNotification(uuid, value, rawDebug);
        if (onData) onData(parseSTM32Inertial(value));
    });

    emitBluetoothDebug({
        type: 'status',
        deviceName: device.name || 'Unavailable',
        status: 'connected',
        subscribedUuids
    });

    return characteristic;
};

const subscribeSTM32MLCRawDebugCharacteristic = async (
    service: BluetoothRemoteGATTService,
    uuid: string,
    device: BluetoothDevice,
    subscribedUuids: string[]
) => {
    try {
        console.log(`STM32 MLC raw debug getCharacteristic start ${uuid}`);
        const characteristic = await getCharacteristicWithRetry(service, uuid);
        console.log(`STM32 MLC raw debug getCharacteristic OK ${uuid}`);

        if (!characteristic.properties.notify) {
            console.warn(`STM32 MLC raw debug characteristic does not support notify: ${uuid}`);
            return null;
        }

        console.log(`STM32 MLC raw debug startNotifications start ${uuid}`);
        await characteristic.startNotifications();
        console.log(`STM32 MLC raw debug startNotifications OK ${uuid}`);

        subscribedUuids.push(uuid);
        emitBluetoothDebug({
            type: 'status',
            deviceName: device.name || 'Unavailable',
            status: 'connected',
            subscribedUuids
        });

        characteristic.addEventListener('characteristicvaluechanged', (e: any) => {
            const value: DataView = e.target.value;
            const bytes = Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
            const hex = bytes.map(byte => byte.toString(16).padStart(2, '0')).join(' ');
            const timestamp = Date.now();
            stm32MLCPacketCount += 1;

            emitBluetoothDebug({
                type: 'mlcPacket',
                uuid,
                packetCount: stm32MLCPacketCount,
                timestamp,
                length: value.byteLength,
                hex,
                firstByte: bytes.length > 0 ? bytes[0] : null
            });
        });

        return characteristic;
    } catch (error) {
        console.warn(`STM32 MLC raw debug subscription skipped ${uuid}`, error);
        return null;
    }
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
        device = await navigator.bluetooth.requestDevice({
            filters: STM32_BLE_NAME_PREFIXES.map(namePrefix => ({ namePrefix })),
            optionalServices: [STM32_FEATURES_SERVICE_UUID]
        });
        console.log(`STM32: Device selected: device.name=${device.name || 'Unavailable'}, device.id=${device.id || 'Unavailable'}`);
        emitBluetoothDebug({
            type: 'status',
            deviceName: device.name || 'Unavailable',
            status: 'connecting',
            subscribedUuids: []
        });

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

        await new Promise(resolve => setTimeout(resolve, 1500));

        console.log(`STM32: Getting primary service ${STM32_FEATURES_SERVICE_UUID}...`);
        step = 'getPrimaryService';
        serviceUuid = STM32_FEATURES_SERVICE_UUID;
        console.log("STM32 STEP 2 START");
        let service: BluetoothRemoteGATTService;
        try {
            service = await getPrimaryServiceWithRetry(server, STM32_FEATURES_SERVICE_UUID);
            console.log("STM32 STEP 2 OK");
        } catch (error) {
            logSTM32StepFailed(2, error);
            throw error;
        }
        console.log(`STM32: Service found: ${STM32_FEATURES_SERVICE_UUID}`);
        console.log(`STM32 known characteristic UUIDs: ${STM32_KNOWN_CHARACTERISTICS.join(', ')}`);
        console.log("STM32 STEP 3 START");
        try {
            const characteristics = await (service as any).getCharacteristics();
            const mappedCharacteristics = (characteristics as BluetoothRemoteGATTCharacteristic[]).map(characteristic => ({
                uuid: characteristic.uuid,
                notify: characteristic.properties.notify,
                indicate: characteristic.properties.indicate,
                read: characteristic.properties.read,
                write: characteristic.properties.write,
                writeWithoutResponse: characteristic.properties.writeWithoutResponse
            }));
            (window as Window & { __smartanchorBleCharacteristics?: typeof mappedCharacteristics }).__smartanchorBleCharacteristics = mappedCharacteristics;
            emitBluetoothDebug({
                type: 'characteristics',
                characteristics: mappedCharacteristics
            });
            console.log("STM32 STEP 3 OK");
        } catch (error) {
            logSTM32StepFailed(3, error);
            throw error;
        }
        const connectedDevice = device;

        recentSTM32RawNotificationLogs = [];
        lastSTM32NotificationAtByUuid = {};
        stm32MLCPacketCount = 0;
        const subscribedUuids: string[] = [];

        step = 'getCharacteristic';
        characteristicUuid = STM32_CHAR_INERTIAL;
        await subscribeSTM32Characteristic(service, STM32_CHAR_INERTIAL, connectedDevice, subscribedUuids, onData);
        await subscribeSTM32MLCRawDebugCharacteristic(service, STM32_CHAR_MLC, connectedDevice, subscribedUuids);

        console.log("STM32 setup complete");
        console.log(`STM32 service UUID: ${serviceUuid}`);
        console.log(`STM32 subscribed UUIDs: ${subscribedUuids.join(', ')}`);
        console.log(`STM32 optional subscriptions temporarily disabled except MLC raw debug: ${STM32_OPTIONAL_NOTIFICATION_CHARS.join(', ')}`);

        return device;
    } catch (error) {
        const enriched = enrichBluetoothError(error, step, device, serviceUuid, characteristicUuid, availableCharacteristics);
        console.error(enriched.message, error);
        emitBluetoothDebug({
            type: 'status',
            deviceName: device?.name || 'Unavailable',
            status: 'failed',
            subscribedUuids: []
        });
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
