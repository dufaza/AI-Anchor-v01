

export interface GeoPosition {
  latitude: number;
  longitude: number;
  accuracy?: number;
  heading?: number | null;
  speed?: number | null;
  timestamp: number;
}

export enum AppTab {
  BOAT = 'boat', // New tab
  CALCULATOR = 'calculator',
  CALIBRATION = 'calibration',
  POSITIONING = 'positioning',
  MONITORING = 'monitoring',
  WATCH = 'watch',
  ASSISTANT = 'assistant',
  SETTINGS = 'settings'
}

export type Submenu = 'none' | 'bluetooth' | 'thresholds' | 'risk_factors' | 'rf_hardware' | 'rf_wind' | 'rf_depth' | 'rf_seabed' | 'rf_scope' | 'rf_swell' | 'current_risk';

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

export interface AnchorStatus {
  isDropped: boolean;
  dropLocation: GeoPosition | null;
  radiusMeters: number;
}

export interface SensorData {
  pitch: number;
  roll: number;
  yaw: number;
  battery: number;
  temperature: number;
  lastUpdate: number;
  isConnected: boolean;
  // Added optional acceleration data for logging
  accX?: number;
  accY?: number;
  accZ?: number;
}

export interface ChainData {
  requiredLength: number;
  actualLength: number;
}

export interface BoatData {
    name: string;
    model: string;
    length: number;
    beam: number;
    draft: number;
    displacement: number; // Boat Weight in kg
    bowHeight: number; // Hauteur Davier
    
    // Ground Tackle
    anchorWeight: number;
    chainTotalLength: number;
    chainDiameter: number;
    chainWeight: number; // kg per meter
}

export type SensorType = 'TI_SENSORTAG' | 'SIMULATOR' | 'STM32_TILEBOX';

export interface RecordingStats {
    fileName: string;
    duration: string;
    points: number;
    frequency: string;
}

export interface RiskParameters {
    // Hardware Factor (Ratio Power/Tonnage)
    hw_weak_threshold: number;      // Default 2.5
    hw_marginal_threshold: number;  // Default 3.5
    hw_standard_threshold: number;  // Default 4.5
    
    // Wind Factor
    wind_safe_limit: number;        // Default 10 kts
    wind_alert_limit: number;       // Default 25 kts
    wind_slope_gentle: number;      // Default 0.01 per kt
    wind_slope_steep: number;       // Default 0.05 per kt

    // Depth Factor
    depth_shallow_limit: number;    // Default 2.5 m
    depth_ideal_limit: number;      // Default 8 m
    depth_deep_limit: number;       // Default 14 m
    depth_shallow_penalty: number;  // Default 0.3
    depth_slope_mid: number;        // Default 0.03
    depth_slope_deep: number;       // Default 0.1

    // Seabed Factor
    seabed_step_multiplier: number; // Default 0.25 (1 + (level-1)*0.25)

    // Swell Factor (NEW)
    swell_safe_limit: number;       // Default 0.5 m
    swell_slope: number;            // Default 0.1 per m
}

export interface AnchorConfig {
  sensorType: SensorType; 
  minPitch: number;
  maxPitch: number;
  minRoll: number;
  maxRoll: number;
  maxYaw: number;
  bluetoothDeviceId: string | null;
  bluetoothDeviceName: string | null;
  seabedRisks: {
    [key: string]: number;
  };
  riskCoefficients: {
    scopeBonus: number;
    scopePenaltyLight: number;
    scopePenaltyMedium: number;
    scopePenaltyHeavy: number;
  };
  riskParameters: RiskParameters; // NEW: Detailed algorithm config
  
  calculatedWindFactor: number;
  calculatedSeabedFactor: number;
  calculatedDepthFactor: number;
  calculatedSwellFactor: number; // NEW: Swell risk adder
  
  mechanicalOffset: {
    pitch: number;
    roll: number;
    yaw?: number;
  };
  monitoringReference: {
    pitch: number;
    roll: number;
    yaw?: number;
  };
}

export interface SmartAnchorState {
    isConnected: boolean;
    isMonitoring: boolean;
    isCalibrated: boolean;
    isPositioned: boolean;
}

// Fix: Add Web Bluetooth API global type definitions
declare global {
  interface Navigator {
    bluetooth: Bluetooth;
  }

  interface Bluetooth {
    requestDevice(options?: RequestDeviceOptions): Promise<BluetoothDevice>;
  }

  interface RequestDeviceOptions {
    filters?: BluetoothLEScanFilter[];
    optionalServices?: (BluetoothServiceUUID)[];
    acceptAllDevices?: boolean;
  }

  interface BluetoothLEScanFilter {
    name?: string;
    namePrefix?: string;
    services?: (BluetoothServiceUUID)[];
  }

  type BluetoothServiceUUID = number | string;

  interface BluetoothDevice {
    id: string;
    name?: string;
    gatt?: BluetoothRemoteGATTServer;
    addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  }

  interface BluetoothRemoteGATTServer {
    device: BluetoothDevice;
    connected: boolean;
    connect(): Promise<BluetoothRemoteGATTServer>;
    disconnect(): void;
    getPrimaryService(service: BluetoothServiceUUID): Promise<BluetoothRemoteGATTService>;
  }

  interface BluetoothRemoteGATTService {
    uuid: string;
    device: BluetoothDevice;
    isPrimary: boolean;
    getCharacteristic(characteristic: BluetoothServiceUUID): Promise<BluetoothRemoteGATTCharacteristic>;
  }

  interface BluetoothRemoteGATTCharacteristic {
    service: BluetoothRemoteGATTService;
    uuid: string;
    properties: BluetoothCharacteristicProperties;
    value?: DataView;
    startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
    stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
    addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
    readValue(): Promise<DataView>;
    writeValue(value: BufferSource): Promise<void>;
  }

  interface BluetoothCharacteristicProperties {
    broadcast: boolean;
    read: boolean;
    writeWithoutResponse: boolean;
    write: boolean;
    notify: boolean;
    indicate: boolean;
    authenticatedSignedWrites: boolean;
    reliableWrite: boolean;
    writableAuxiliaries: boolean;
  }
}