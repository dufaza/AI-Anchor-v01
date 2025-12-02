
// ... imports
import React, { useState, useEffect, useRef, useCallback } from 'react';
import Navigation from './components/Navigation';
import ScopeCalculator from './components/ScopeCalculator';
import AnchorWatch from './components/AnchorWatch';
import AIAssistant from './components/AIAssistant';
import SmartAnchor from './components/SmartAnchor';
import Settings from './components/Settings';
import BoatSettings from './components/BoatSettings';
import { AppTab, AnchorConfig, ChainData, SmartAnchorState, SensorData, BoatData, Submenu, RecordingStats } from './types';
import { bluetoothService } from './services/bluetoothService';
import { Anchor } from 'lucide-react';

// SPLASH SCREEN COMPONENT
const SplashScreen = () => (
    <div className="fixed inset-0 z-[100] bg-ocean-900 flex flex-col items-center justify-center text-center p-6 animate-in fade-in duration-700">
        {/* Background Image */}
        <div className="absolute inset-0 bg-black">
            <img 
                src="https://images.unsplash.com/photo-1544551763-46a8723ba3f9?q=80&w=2070&auto=format&fit=crop" 
                alt="Anchor Background" 
                className="w-full h-full object-cover opacity-40"
            />
            {/* Gradient Overlay for text readability */}
            <div className="absolute inset-0 bg-gradient-to-t from-ocean-900 via-ocean-900/50 to-transparent"></div>
        </div>
        
        <div className="relative z-10 flex flex-col items-center">
            {/* Logo Circle */}
            <div className="w-28 h-28 bg-ocean-800/80 backdrop-blur-md rounded-full flex items-center justify-center mb-8 shadow-[0_0_50px_rgba(56,189,248,0.4)] border-2 border-ocean-500/30">
                <Anchor className="w-14 h-14 text-ocean-400" />
            </div>
            
            {/* Main Title */}
            <h1 className="text-6xl font-black text-white tracking-tighter mb-6 drop-shadow-2xl">
                AI-Anchor
            </h1>
            
            {/* Separator */}
            <div className="w-24 h-1.5 bg-gradient-to-r from-transparent via-ocean-500 to-transparent rounded-full mb-8"></div>
            
            {/* Slogan */}
            <p className="text-ocean-100 text-xl font-light max-w-xs leading-relaxed drop-shadow-md">
                The best AI smart Anchor with a touch of Human Expertise
            </p>
        </div>

        {/* Footer Copyright */}
        <div className="absolute bottom-8 right-8 text-ocean-400/60 text-xs font-mono tracking-widest uppercase">
            Copyright by C. Dufaza
        </div>
    </div>
);

export const App: React.FC = () => {
    // --- SPLASH SCREEN STATE ---
    // Shows for 5 seconds on load
    const [showSplashScreen, setShowSplashScreen] = useState(true);

    // Default to Boat tab for first time setup, or Calculator
    const [currentTab, setCurrentTab] = useState<AppTab>(AppTab.BOAT);
    
    // Lifted State for Settings Navigation
    const [activeSubmenu, setActiveSubmenu] = useState<Submenu>('none');

    const [windSpeed, setWindSpeed] = useState<number>(15);
    const [swellHeight, setSwellHeight] = useState<number>(0.5); 
    const [depth, setDepth] = useState<number>(6); 
    const [seabedType, setSeabedType] = useState<string>('Sand');

    // New Boat Data State
    const [boatData, setBoatData] = useState<BoatData>({
        name: 'YODA',
        model: 'Dufour 390 GL',
        length: 0,
        beam: 0,
        draft: 0,
        displacement: 0, // Boat Weight in kg
        bowHeight: 1.0, // Default 1m freeboard
        // Default Ground Tackle
        anchorWeight: 25,
        chainTotalLength: 60,
        chainDiameter: 10,
        chainWeight: 2.3
    });

    const [chainData, setChainData] = useState<ChainData>({
        requiredLength: 0,
        actualLength: 0
    });

    const [smartAnchorState, setSmartAnchorState] = useState<SmartAnchorState>({
        isConnected: false,
        isMonitoring: false,
        isCalibrated: false,
        isPositioned: false
    });

    const [sensorData, setSensorData] = useState<SensorData>({
        pitch: 0,
        roll: 0,
        yaw: 0,
        accX: 0,
        accY: 0,
        accZ: 0,
        battery: 0,
        temperature: 0,
        lastUpdate: Date.now(),
        isConnected: false
    });

    const deviceRef = useRef<BluetoothDevice | null>(null);
    const lastUpdateRef = useRef<number>(0);

    // --- DATA LOGGING FOR AI TRAINING (STM MEMS STUDIO) ---
    const [isRecording, setIsRecording] = useState(false);
    // UI state for showing stats after recording
    const [recordingStats, setRecordingStats] = useState<RecordingStats | null>(null);
    
    // Use a Ref to track recording state inside the Bluetooth callback (closure)
    const isRecordingRef = useRef(false);
    
    const logsRef = useRef<string[]>([]);
    const recordingStartTimeRef = useRef<number | null>(null);

    const handleStartRecording = useCallback(() => {
        // Clear previous stats
        setRecordingStats(null);
        
        // REQ 1: Header format: Timestamp_s,A_X[mg],A_Y[mg],A_Z[mg]
        logsRef.current = ["Timestamp_s,A_X[mg],A_Y[mg],A_Z[mg]"];
        // Reset start time so first point is 0
        recordingStartTimeRef.current = null;
        
        // Sync both State (for UI) and Ref (for Callback)
        setIsRecording(true);
        isRecordingRef.current = true;
        
        console.log("App: Data Logging Started at 100Hz target (10ms) - Direct Stream Mode");
    }, []);

    const handleStopRecording = useCallback(async () => {
        // Stop logic first to freeze data
        const wasRecording = isRecordingRef.current;
        setIsRecording(false);
        isRecordingRef.current = false;
        
        // Generate filename immediately for display
        const now = new Date();
        const dateStr = now.getFullYear() + "-" +
                        String(now.getMonth() + 1).padStart(2, '0') + "-" +
                        String(now.getDate()).padStart(2, '0') + "-" +
                        String(now.getHours()).padStart(2, '0') + "-" +
                        String(now.getMinutes()).padStart(2, '0') + "-" +
                        String(now.getSeconds()).padStart(2, '0');
        const fileName = `AI-Anchor-v01_log_${dateStr}.csv`;

        // Check for empty data
        if (!wasRecording || logsRef.current.length <= 1) {
            alert("Recording stopped but no data was captured.\n\nPossible reasons:\n- Connection lost\n- Duration too short");
            return; 
        }

        // Calculate Stats
        const endTime = Date.now();
        const startTime = recordingStartTimeRef.current || endTime;
        const durationSec = ((endTime - startTime) / 1000).toFixed(2);
        const dataPoints = logsRef.current.length - 1; // Subtract header
        const approxFreq = (dataPoints / parseFloat(durationSec)).toFixed(1);

        // Update UI with Stats (No blocking alert)
        setRecordingStats({
            fileName,
            duration: durationSec,
            points: dataPoints,
            frequency: approxFreq
        });

        // Generate CSV Data
        const csvContent = logsRef.current.join("\n");
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        
        // METHOD 1: Web Share API (Primary for iOS/Bluefy)
        if (navigator.share && navigator.canShare) {
            try {
                const file = new File([blob], fileName, { type: "text/csv" });
                if (navigator.canShare({ files: [file] })) {
                    await navigator.share({
                        files: [file],
                        title: 'SmartAnchor Log',
                        text: `Log: ${fileName}\nDuration: ${durationSec}s`
                    });
                    console.log("App: Shared successfully via Web Share API");
                    return; 
                }
            } catch (error) {
                console.warn("App: Share API failed/cancelled, triggering fallback download...", error);
            }
        }

        // METHOD 2: Classic Download Link (Fallback & Safety Net)
        try {
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.setAttribute("href", url);
            link.setAttribute("download", fileName);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            console.log("App: Data Logs Download Triggered (Safety Net)");
        } catch (e) {
            console.error("App: Fallback download failed", e);
        }
    }, []);

    const [anchorConfig, setAnchorConfig] = useState<AnchorConfig>({
        sensorType: 'SIMULATOR', 
        minPitch: -40, maxPitch: 40, minRoll: -45, maxRoll: 45, maxYaw: 150,    
        bluetoothDeviceId: null, bluetoothDeviceName: null,
        seabedRisks: { 'Sand': 1, 'Herbarium': 2, 'Vase': 3, 'Rock': 5, 'Other': 2 },
        riskCoefficients: { scopeBonus: 0.8, scopePenaltyLight: 1.1, scopePenaltyMedium: 1.5, scopePenaltyHeavy: 2.2 },
        riskParameters: {
            hw_weak_threshold: 2.5,
            hw_marginal_threshold: 3.5,
            hw_standard_threshold: 4.5,
            wind_safe_limit: 10,
            wind_alert_limit: 25,
            wind_slope_gentle: 0.01,
            wind_slope_steep: 0.05,
            depth_shallow_limit: 2.5,
            depth_ideal_limit: 8,
            depth_deep_limit: 14,
            depth_shallow_penalty: 0.3,
            depth_slope_mid: 0.03,
            depth_slope_deep: 0.1,
            seabed_step_multiplier: 0.25,
            swell_safe_limit: 0.5,
            swell_slope: 0.1
        },
        calculatedWindFactor: 0, calculatedSeabedFactor: 1.0, calculatedDepthFactor: 0, calculatedSwellFactor: 0,
        mechanicalOffset: { pitch: 0, roll: 0, yaw: 0 }, monitoringReference: { pitch: 0, roll: 0, yaw: 0 }
    });

    // Handle Splash Screen Timer (5 seconds)
    useEffect(() => {
        const timer = setTimeout(() => {
            setShowSplashScreen(false);
        }, 5000); 
        return () => clearTimeout(timer);
    }, []);

    const handleBluetoothConnect = useCallback(async () => {
        try {
            const device = await bluetoothService.connect(
                anchorConfig.sensorType,
                (newData) => { 
                    const now = Date.now();

                    // --- 1. CRITICAL: RECORDING LOGIC (Direct Stream, Unthrottled) ---
                    // FIX: Relaxed condition. We record if recording is active, regardless of whether 
                    // raw accX exists or not. If missing, we default to 0. This ensures the CSV is never empty.
                    if (isRecordingRef.current) {
                        if (recordingStartTimeRef.current === null) {
                            recordingStartTimeRef.current = now;
                        }
                        const relativeTimeMs = now - recordingStartTimeRef.current;
                        const relativeTimeSec = (relativeTimeMs / 1000).toFixed(3);
                        
                        // Default to 0 if raw data is missing (connection issue or Fusion-only mode)
                        const ax = newData.accX !== undefined ? newData.accX : 0;
                        const ay = newData.accY !== undefined ? newData.accY : 0;
                        const az = newData.accZ !== undefined ? newData.accZ : 0;

                        // Log format: Timestamp_s,A_X[mg],A_Y[mg],A_Z[mg]
                        const line = `${relativeTimeSec},${ax.toFixed(4)},${ay.toFixed(4)},${az.toFixed(4)}`;
                        logsRef.current.push(line);
                    }

                    // --- 2. UI UPDATE LOGIC (Throttled) ---
                    // We only update React state every 30ms (~33 FPS) to keep the UI smooth 
                    // but not overload the main thread, allowing the bluetooth callback to run fast for logging.
                    if (now - lastUpdateRef.current > 30) {
                        setSensorData(prev => ({
                            ...prev, 
                            ...newData, 
                            lastUpdate: now, 
                            isConnected: true
                        })); 
                        lastUpdateRef.current = now;
                    }
                },
                () => { 
                    setSensorData(prev => ({ ...prev, isConnected: false })); 
                    setSmartAnchorState(prev => ({ ...prev, isConnected: false, isMonitoring: false })); 
                }
            );
            
            deviceRef.current = device;
            setAnchorConfig(prev => ({...prev, bluetoothDeviceId: device.id, bluetoothDeviceName: device.name || "Sensor"}));
            setSmartAnchorState(prev => ({ ...prev, isConnected: true }));
            setSensorData(prev => ({ ...prev, isConnected: true }));

        } catch (error) { 
            console.error("Connection failed", error); 
            throw error; 
        }
    }, [anchorConfig.sensorType]);

    const handleBluetoothDisconnect = useCallback(() => {
        bluetoothService.disconnect(deviceRef.current); 
        deviceRef.current = null;
        setSensorData(prev => ({ ...prev, isConnected: false }));
        setSmartAnchorState(prev => ({ ...prev, isConnected: false, isMonitoring: false, isCalibrated: false, isPositioned: false }));
        setAnchorConfig(prev => ({ ...prev, bluetoothDeviceId: null, bluetoothDeviceName: null }));
    }, []);

    const handleSetCalibration = useCallback((type: 'mechanical' | 'monitoring', pitch: number, roll: number, yaw: number = 0) => {
        setAnchorConfig(prev => ({...prev, [type === 'mechanical' ? 'mechanicalOffset' : 'monitoringReference']: { pitch, roll, yaw }}));
    }, []);

    const handleSwitchTab = useCallback((tab: AppTab) => { setCurrentTab(tab); }, []);

    const handleConnectRequest = useCallback(() => {
        setCurrentTab(AppTab.SETTINGS);
        setActiveSubmenu('bluetooth');
    }, []);

    useEffect(() => {
        const p = anchorConfig.riskParameters;
        let windFactor = 0;
        if (windSpeed <= p.wind_safe_limit) {
            windFactor = 0;
        } else if (windSpeed <= p.wind_alert_limit) {
            windFactor = (windSpeed - p.wind_safe_limit) * p.wind_slope_gentle;
        } else {
            const baseAccumulated = (p.wind_alert_limit - p.wind_safe_limit) * p.wind_slope_gentle;
            windFactor = baseAccumulated + ((windSpeed - p.wind_alert_limit) * p.wind_slope_steep);
        }
        
        let depthFactor = 0;
        if (depth < p.depth_shallow_limit) {
            depthFactor = p.depth_shallow_penalty; 
        } else if (depth <= p.depth_ideal_limit) {
            depthFactor = 0;
        } else if (depth <= p.depth_deep_limit) {
            depthFactor = (depth - p.depth_ideal_limit) * p.depth_slope_mid;
        } else {
            const baseMid = (p.depth_deep_limit - p.depth_ideal_limit) * p.depth_slope_mid;
            depthFactor = 0.2 + baseMid + ((depth - p.depth_deep_limit) * p.depth_slope_deep);
        }

        let swellFactor = 0;
        if (swellHeight <= p.swell_safe_limit) {
            swellFactor = 0;
        } else {
            swellFactor = (swellHeight - p.swell_safe_limit) * p.swell_slope;
        }

        setAnchorConfig(prev => ({
            ...prev, 
            calculatedWindFactor: parseFloat(windFactor.toFixed(2)), 
            calculatedDepthFactor: parseFloat(depthFactor.toFixed(2)), 
            calculatedSwellFactor: parseFloat(swellFactor.toFixed(2)),
            riskCoefficients: { 
                ...prev.riskCoefficients, 
                scopePenaltyLight: parseFloat((1.1 + windFactor).toFixed(2)), 
                scopePenaltyMedium: parseFloat((1.5 + (windFactor * 1.2)).toFixed(2)), 
                scopePenaltyHeavy: parseFloat((2.2 + (windFactor * 2)).toFixed(2)) 
            }
        }));
    }, [windSpeed, depth, swellHeight, anchorConfig.riskParameters]);

    useEffect(() => {
        const userRiskLevel = anchorConfig.seabedRisks[seabedType] || 1;
        const factor = 1 + ((userRiskLevel - 1) * anchorConfig.riskParameters.seabed_step_multiplier);
        setAnchorConfig(prev => ({ ...prev, calculatedSeabedFactor: factor }));
    }, [seabedType, anchorConfig.seabedRisks, anchorConfig.riskParameters]);

    return (
        <div className="h-[100dvh] bg-ocean-900 text-slate-50 font-sans overflow-hidden selection:bg-ocean-500 selection:text-white">
            
            {showSplashScreen && <SplashScreen />}

            <main className="h-full w-full max-w-md mx-auto bg-ocean-900 relative shadow-2xl flex flex-col">
                <div className="flex-1 w-full pt-safe-top pb-20 overflow-y-auto overflow-x-hidden"> 
                    
                    {currentTab === AppTab.BOAT && (
                        <BoatSettings boatData={boatData} setBoatData={setBoatData} />
                    )}

                    {currentTab === AppTab.CALCULATOR && (
                        <ScopeCalculator 
                            seabedType={seabedType} 
                            setSeabedType={setSeabedType} 
                            chainData={chainData} 
                            setChainData={setChainData} 
                            windSpeed={windSpeed} 
                            setWindSpeed={setWindSpeed} 
                            swellHeight={swellHeight} 
                            setSwellHeight={setSwellHeight} 
                            depth={depth} 
                            setDepth={setDepth} 
                            defaultFreeboard={boatData.bowHeight} 
                            maxChainLength={boatData.chainTotalLength}
                            seabedRiskFactor={anchorConfig.calculatedSeabedFactor}
                        />
                    )}
                    
                    {currentTab === AppTab.CALIBRATION && (
                        <SmartAnchor 
                            viewMode="calibration" 
                            config={anchorConfig} 
                            seabedType={seabedType} 
                            chainData={chainData} 
                            boatData={boatData} 
                            smartAnchorState={smartAnchorState} 
                            setSmartAnchorState={setSmartAnchorState} 
                            sensorData={sensorData} 
                            onNavigate={handleSwitchTab} 
                            onCalibrate={handleSetCalibration}
                            onConnectRequest={handleConnectRequest}
                        />
                    )}

                    {currentTab === AppTab.POSITIONING && (
                        <SmartAnchor 
                            viewMode="validation" 
                            config={anchorConfig} 
                            seabedType={seabedType} 
                            chainData={chainData} 
                            boatData={boatData} 
                            smartAnchorState={smartAnchorState} 
                            setSmartAnchorState={setSmartAnchorState} 
                            sensorData={sensorData} 
                            onNavigate={handleSwitchTab} 
                            onCalibrate={handleSetCalibration} 
                            onConnectRequest={handleConnectRequest}
                            // Pass Logging Props
                            isRecording={isRecording}
                            onStartRecording={handleStartRecording}
                        />
                    )}

                    {currentTab === AppTab.MONITORING && (
                        <SmartAnchor 
                            viewMode="monitoring" 
                            config={anchorConfig} 
                            seabedType={seabedType} 
                            chainData={chainData} 
                            boatData={boatData} 
                            smartAnchorState={smartAnchorState} 
                            setSmartAnchorState={setSmartAnchorState} 
                            sensorData={sensorData} 
                            onNavigate={handleSwitchTab} 
                            onCalibrate={handleSetCalibration} 
                            onConnectRequest={handleConnectRequest}
                            // Pass Logging Props
                            isRecording={isRecording}
                            onStopRecording={handleStopRecording}
                            recordingStats={recordingStats}
                        />
                    )}

                    {currentTab === AppTab.WATCH && <AnchorWatch />}
                    
                    {currentTab === AppTab.ASSISTANT && (
                        <AIAssistant 
                            boatData={boatData}
                            windSpeed={windSpeed}
                            depth={depth}
                            seabedType={seabedType}
                            chainData={chainData}
                            sensorData={sensorData}
                            riskScore={1} 
                        />
                    )}
                     
                    {currentTab === AppTab.SETTINGS && (
                        <Settings 
                            config={anchorConfig} 
                            setConfig={setAnchorConfig} 
                            onConnect={handleBluetoothConnect} 
                            onDisconnect={handleBluetoothDisconnect} 
                            isConnected={sensorData.isConnected}
                            onNavigate={handleSwitchTab}
                            activeSubmenu={activeSubmenu}
                            setActiveSubmenu={setActiveSubmenu}
                            boatData={boatData}
                            windSpeed={windSpeed}
                            swellHeight={swellHeight}
                            depth={depth}
                            seabedType={seabedType}
                            chainData={chainData}
                        />
                    )}
                </div>
                {!showSplashScreen && <Navigation currentTab={currentTab} setTab={setCurrentTab} />}
            </main>
        </div>
    );
}; 
export default App;