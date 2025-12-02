# SmartAnchor - Technical Context & Documentation

## Overview
**SmartAnchor** is a mobile-first React application designed for maritime anchoring safety. It combines sensor data (simulated or real), environmental inputs, and algorithmic logic to provide real-time risk analysis.

## Architecture
*   **Framework**: React 18 with TypeScript.
*   **Styling**: TailwindCSS (Custom 'Ocean' theme).
*   **State Management**: "Lifting State Up" pattern. Global state resides in `App.tsx` and is propagated via props to ensure data persistence across tab navigation.

## Core Modules

### 1. Scope Calculator (`ScopeCalculator.tsx`)
*   **Inputs**: Depth, Bow Height, Wind Speed, Seabed Type.
*   **Logic**: Auto-calculates the recommended scope ratio based on wind severity (e.g., 3:1 for calm, 10:1 for storm).
*   **Persistence**: Syncs `chainData` and `windSpeed` to the global App state.

### 2. Smart Anchor (`SmartAnchor.tsx`)
*   **Function**: 3D visualization of the anchor and real-time risk monitoring.
*   **Simulation**: Uses a declarative `useEffect` loop dependent on `isConnected` state to simulate accelerometer data (Pitch/Roll).
*   **Risk Engine**: A normalized scoring system (1-10) indicating drag risk.

### 3. Anchor Watch (`AnchorWatch.tsx`)
*   **Function**: Geolocation-based drift alarm.
*   **Features**: Visual radar, distance calculation (Haversine formula), and acoustic/vibration alarms.

### 4. Configuration (`Settings.tsx`)
*   **Function**: Fine-tuning of algorithmic weights and Sensor selection.
*   **Structure**: Hierarchical menus (Connectivity, Thresholds, Seabed Risks, Chain Penalties).

### 5. Hardware Integration (`bluetoothService.ts`)
The app supports a Driver-based architecture for Bluetooth Low Energy sensors:
*   **Simulator**: Generates artificial wave motion for testing.
*   **TI SensorTag (CC2650)**: Legacy support for Texas Instruments sensors.
*   **STM32 SensorTile Box Pro**: Advanced support using Sensor Fusion (Quaternions) via the ST BlueST protocol.

---

## Risk Algorithm Logic

The application calculates a **Risk Score (1-10)**.

**Formula:**
`Risk = (Base Motion + Wind Adder + Depth Adder) × Seabed Multiplier × Chain Scope Multiplier`

### 1. Base Adders (Accumulated Risk)
These factors constitute the baseline instability.
*   **Motion Risk (0.0 - 1.0):** Real-time accelerometer data. Ratio of `Current Angle / Max Configured Angle`.
*   **Wind Adder:** `(WindSpeed - 10) * 0.02`. Adds risk for every knot above 10kts.
*   **Depth Adder:**
    *   Shallow (<3m): `+0.20` (Tide risk).
    *   Deep (>20m): `(Depth - 20) * 0.01` per meter.

### 2. Multipliers (Amplifiers)
These factors multiply the accumulated risk, effectively scaling the danger.
*   **Seabed Multiplier (1.0x - 2.0x):**
    *   Derived from User Settings (1-5 Scale).
    *   Sand (1) = 1.0x
    *   Rock (5) = 2.0x
*   **Chain Scope Multiplier:**
    *   **Bonus (Safe):** If Actual > Required Chain -> `x0.8` (Configurable).
    *   **Neutral:** If Actual = Required -> `x1.0`.
    *   **Light Penalty:** Short by <3m -> `x1.1` (Scales with wind).
    *   **Medium Penalty:** Short by 3-10m -> `x1.5` (Scales with wind).
    *   **Critical Penalty:** Short by >10m -> `x2.2` (Scales with wind).

---

## Directory Structure
```
/src
  App.tsx             # Global State Store & Router
  types.ts            # Interface Definitions
  /components
    ScopeCalculator.tsx
    SmartAnchor.tsx
    AnchorWatch.tsx
    Settings.tsx
    Navigation.tsx
    AIAssistant.tsx
  /services
    geminiService.ts
    bluetoothService.ts # Drivers for TI and STM32
```