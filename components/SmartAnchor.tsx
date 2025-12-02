
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Bluetooth, CheckCircle, AlertTriangle, Wifi, Battery, ShieldCheck, ShieldAlert, Unlock, Activity, BarChart3, Layers, Link as LinkIcon, ThumbsUp, Gauge, Scale, ArrowDown, MoveVertical, MoveHorizontal, Ruler, RefreshCw, Info, Weight, Waves, Compass, Play, ArrowDownCircle, Anchor, ArrowDownToLine, Ship, CheckCircle2, Gamepad2, Timer, ClipboardCheck, ChevronRight, Download, FileText, CircleDot, CircleOff, RotateCw, Sigma, Wind } from 'lucide-react';
import { SensorData, AnchorConfig, ChainData, SmartAnchorState, AppTab, BoatData, RecordingStats } from '../types';

interface SmartAnchorProps {
    viewMode: 'validation' | 'monitoring' | 'calibration';
    config: AnchorConfig;
    seabedType: string;
    chainData: ChainData;
    boatData: BoatData; 
    smartAnchorState: SmartAnchorState;
    setSmartAnchorState: React.Dispatch<React.SetStateAction<SmartAnchorState>>;
    sensorData: SensorData;
    onNavigate: (tab: AppTab) => void;
    onCalibrate: (type: 'mechanical' | 'monitoring', pitch: number, roll: number, yaw: number) => void;
    onConnectRequest?: () => void;
    
    // New Props for Data Logging
    isRecording?: boolean;
    onStartRecording?: () => void;
    onStopRecording?: () => void;
    recordingStats?: RecordingStats | null;
}

// 6-Phase Drop Sequence (Logical states)
type DropPhase = 'IDLE' | 'DAVIER' | 'DROPPING' | 'ON_SOIL' | 'SETTING' | 'STABLE';

const SmartAnchor: React.FC<SmartAnchorProps> = ({ 
    viewMode,
    config, 
    seabedType, 
    chainData,
    boatData,
    smartAnchorState,
    setSmartAnchorState,
    sensorData,
    onNavigate,
    onCalibrate,
    onConnectRequest,
    isRecording,
    onStartRecording,
    onStopRecording,
    recordingStats
}) => {
    const [smoothPitch, setSmoothPitch] = useState(0);
    const [smoothRoll, setSmoothRoll] = useState(0);
    const [smoothYaw, setSmoothYaw] = useState(0);

    // Simulation Overrides
    const [simOverride, setSimOverride] = useState<{pitch: number, roll: number, noise: boolean} | null>(null);

    const [alarmTriggered, setAlarmTriggered] = useState(false);
    const [riskScore, setRiskScore] = useState<number>(1);
    const [riskTrend, setRiskTrend] = useState<'stable' | 'rising' | 'falling'>('stable');
    const prevRiskRef = useRef<number>(1);
    
    const [showCalibSuccess, setShowCalibSuccess] = useState(false);

    // Flow Management
    const [calibCountdown, setCalibCountdown] = useState<number | null>(null);
    const [posCountdown, setPosCountdown] = useState<number | null>(null);

    // NEW: Drop Sequence State
    const [dropPhase, setDropPhase] = useState<DropPhase>('IDLE');
    const [phaseStartTime, setPhaseStartTime] = useState<number>(0); // Track when we entered the current phase
    const [stableStartTime, setStableStartTime] = useState<number | null>(null);
    
    // Sequence Global Timer
    const [sequenceStartTime, setSequenceStartTime] = useState<number | null>(null);
    const [currentTimerTick, setCurrentTimerTick] = useState<number>(Date.now());

    // Ref to track phase changes for timing resets
    const prevPhaseRef = useRef<DropPhase>('IDLE');

    // Toggle for Optional Recording
    const [isRecordEnabled, setIsRecordEnabled] = useState(true);

    useEffect(() => {
        // Reduced smoothing factor for stability (0.2 -> 0.08)
        // This acts as a stronger low-pass filter to remove jitter
        const smoothingFactor = 0.08; 
        
        let targetPitch = sensorData.pitch;
        let targetRoll = sensorData.roll;

        // Apply Simulation Override if active and we are in Simulator mode
        if (config.sensorType === 'SIMULATOR' && simOverride) {
            targetPitch = simOverride.pitch;
            targetRoll = simOverride.roll;
            if (simOverride.noise) {
                targetPitch += (Math.random() - 0.5) * 15; // +/- 7.5 deg noise
                targetRoll += (Math.random() - 0.5) * 15;
            }
        }

        setSmoothPitch(prev => prev + (targetPitch - prev) * smoothingFactor);
        setSmoothRoll(prev => prev + (targetRoll - prev) * smoothingFactor);
        setSmoothYaw(prev => prev + (sensorData.yaw - prev) * smoothingFactor);
    }, [sensorData, simOverride, config.sensorType]); 

    // --- APPLY OFFSETS TO ALL 3 AXES ---
    const displayedPitch = smoothPitch - (config.mechanicalOffset?.pitch || 0);
    const displayedRoll = smoothRoll - (config.mechanicalOffset?.roll || 0);
    let displayedYaw = smoothYaw - (config.mechanicalOffset?.yaw || 0);
    if (displayedYaw < 0) displayedYaw += 360;
    if (displayedYaw >= 360) displayedYaw -= 360;

    // --- GLOBAL TIMER TICKER ---
    useEffect(() => {
        let interval: any;
        if (dropPhase !== 'IDLE') {
            interval = setInterval(() => {
                setCurrentTimerTick(Date.now());
            }, 100);
        }
        return () => { if (interval) clearInterval(interval); };
    }, [dropPhase]);

    // --- CENTRALIZED RISK ENGINE (SINGLE SOURCE OF TRUTH) ---
    // Calculates all factors and dynamic limits ONCE, to be used by both UI and Alarm Logic.
    const riskContext = useMemo(() => {
        // 1. Hardware Factor
        let hwFactor = 1.0;
        const params = config.riskParameters;
        const displacementTonnes = boatData.displacement / 1000;
        if (displacementTonnes > 0 && boatData.anchorWeight > 0) {
            const chainW = boatData.chainWeight || 1.8; 
            const tacklePower = boatData.anchorWeight + (chainW * 10);
            const ratio = tacklePower / displacementTonnes;
            if (ratio < params.hw_weak_threshold) { hwFactor = 1.5; } 
            else if (ratio < params.hw_marginal_threshold) { 
                const range = params.hw_marginal_threshold - params.hw_weak_threshold;
                const pos = ratio - params.hw_weak_threshold;
                hwFactor = 1.5 - ((pos / range) * 0.5); 
            } 
            else if (ratio <= params.hw_standard_threshold) { hwFactor = 1.0; } 
            else { hwFactor = 0.8; }
        }

        // 2. Scope Factor
        let scopeMultiplier = 1.0;
        if (chainData.requiredLength > 0 && chainData.actualLength > 0) {
            const shortage = chainData.requiredLength - chainData.actualLength;
            if (shortage < 0) { scopeMultiplier = config.riskCoefficients.scopeBonus; } 
            else if (shortage === 0) { scopeMultiplier = 1.0; }
            else if (shortage <= 3) { scopeMultiplier = config.riskCoefficients.scopePenaltyLight; } 
            else if (shortage <= 10) { scopeMultiplier = config.riskCoefficients.scopePenaltyMedium; } 
            else { scopeMultiplier = config.riskCoefficients.scopePenaltyHeavy; }
        }

        // 3. Env Risk
        const baseEnvRisk = config.calculatedWindFactor + (config.calculatedDepthFactor || 0) + (config.calculatedSwellFactor || 0);
        const seabedFactor = config.calculatedSeabedFactor || 1.0;
        
        const environmentalRisk = baseEnvRisk * seabedFactor * scopeMultiplier * hwFactor;

        // 4. Vigilance & Dynamic Limits
        // If Risk is High -> Vigilance Increases -> Limits Decrease (Stricter)
        let vigilanceMultiplier = 1.0;
        if (environmentalRisk > 1.0) vigilanceMultiplier = 2.0;
        else if (environmentalRisk > 0.5) vigilanceMultiplier = 1.5;
        
        const effectiveLimits = {
            pitch: config.maxPitch / vigilanceMultiplier,
            roll: config.maxRoll / vigilanceMultiplier,
            yaw: config.maxYaw / vigilanceMultiplier
        };

        // 5. Active Drivers (UI Helpers)
        const activeDrivers = [];
        if (config.calculatedWindFactor > 0.5) activeDrivers.push({ name: 'High Wind', color: 'text-blue-400', border: 'border-blue-500/50' });
        if (config.calculatedSwellFactor > 0.2) activeDrivers.push({ name: 'Swell', color: 'text-indigo-400', border: 'border-indigo-500/50' });
        if (config.calculatedDepthFactor > 0.3) activeDrivers.push({ name: 'Depth Risk', color: 'text-cyan-400', border: 'border-cyan-500/50' });
        if (config.calculatedSeabedFactor > 1.2) activeDrivers.push({ name: 'Poor Holding', color: 'text-yellow-400', border: 'border-yellow-500/50' });
        if (hwFactor > 1.1) activeDrivers.push({ name: 'Gear Limit', color: 'text-purple-400', border: 'border-purple-500/50' });
        if (chainData.requiredLength > 0 && chainData.actualLength > 0) {
             if (chainData.requiredLength > chainData.actualLength + 2) activeDrivers.push({ name: 'Short Chain', color: 'text-orange-400', border: 'border-orange-500/50' });
        }

        return {
            hwFactor,
            scopeMultiplier,
            environmentalRisk,
            vigilanceMultiplier,
            effectiveLimits,
            activeDrivers
        };
    }, [config, seabedType, chainData, boatData]);

    // --- ALARM LOGIC (Consuming Centralized Risk Context) ---
    useEffect(() => {
        const { effectiveLimits, environmentalRisk } = riskContext;

        const devPitch = displayedPitch - config.monitoringReference.pitch;
        const devRoll = displayedRoll - config.monitoringReference.roll;
        let devYaw = displayedYaw - (config.monitoringReference.yaw || 0);
        if (devYaw > 180) devYaw -= 360;
        if (devYaw < -180) devYaw += 360;

        // Calculate Motion Risk using DYNAMIC limits
        const motionRisk = Math.max(
            Math.abs(devPitch) / Math.abs(effectiveLimits.pitch),
            Math.abs(devRoll) / Math.abs(effectiveLimits.roll),
            Math.abs(devYaw) / effectiveLimits.yaw
        );

        // Final Score
        const totalRiskIndex = motionRisk + environmentalRisk;
        let score = Math.ceil(totalRiskIndex * 10);
        if (motionRisk > 0.6) score = Math.max(score, 4);
        if (motionRisk >= 1.0) score = Math.max(score, 9);
        score = Math.min(10, Math.max(1, score));

        if (score > prevRiskRef.current) setRiskTrend('rising');
        else if (score < prevRiskRef.current) setRiskTrend('falling');
        else setRiskTrend('stable');
        prevRiskRef.current = score;
        setRiskScore(score);

        if (score >= 9) setAlarmTriggered(true);
        else if (score < 8) setAlarmTriggered(false);

    }, [displayedPitch, displayedRoll, displayedYaw, riskContext, config.monitoringReference]);

    // --- AUTOMATIC SEQUENCE TRANSITIONS ---
    useEffect(() => {
        // Phase Change Guard:
        if (dropPhase !== prevPhaseRef.current) {
            prevPhaseRef.current = dropPhase;
            setPhaseStartTime(Date.now());
            setStableStartTime(null);
            
            // Handle Global Timer Reset
            if (dropPhase === 'IDLE') {
                setSequenceStartTime(null);
            } else if (dropPhase === 'DAVIER' && !sequenceStartTime) {
                // Should be set by button click, but safety check here
                setSequenceStartTime(Date.now());
            }

            return; // Wait for re-render with new timestamp
        }

        if (viewMode !== 'validation' || !sensorData.isConnected) return;

        const now = Date.now();
        const pitch = Math.abs(displayedPitch);
        
        let rawPitch = sensorData.pitch;
        if (config.sensorType === 'SIMULATOR' && simOverride) rawPitch = simOverride.pitch + (simOverride.noise ? (Math.random()*10) : 0);
        
        const noiseLevel = Math.abs(rawPitch - smoothPitch);

        // 1. DAVIER -> DROPPING (Pitch dips > 60°)
        if (dropPhase === 'DAVIER') {
            if (pitch > 60) setDropPhase('DROPPING');
        } 
        // 2. DROPPING -> ON_SOIL (Pitch returns to horizontal < 30°)
        else if (dropPhase === 'DROPPING') {
            if (pitch < 30) setDropPhase('ON_SOIL');
        }
        // 3. ON_SOIL -> SETTING (Digging)
        else if (dropPhase === 'ON_SOIL') {
             const timeElapsed = now - phaseStartTime;
             const vibrationDetected = noiseLevel > 10.0;
             // Grace Period: 2s (reduced from 5s). Timeout: 5s (reduced from 10s)
             if ((timeElapsed > 2000 && vibrationDetected) || timeElapsed > 5000) {
                 setDropPhase('SETTING');
             }
        }
        // 4. SETTING -> STABLE (Stability check)
        else if (dropPhase === 'SETTING') {
            const isStable = noiseLevel < 5.0;
            
            if (isStable) {
                if (!stableStartTime) {
                    setStableStartTime(now);
                } else {
                    const stabilityDuration = now - stableStartTime;
                    if (stabilityDuration > 20000) { // 20 Seconds Requirement
                        setDropPhase('STABLE');
                    }
                }
            } else {
                setStableStartTime(null); 
            }
        }
    }, [dropPhase, displayedPitch, smoothPitch, riskScore, stableStartTime, viewMode, sensorData.isConnected, sensorData.pitch, simOverride, config.sensorType, phaseStartTime, sequenceStartTime]);

    // Auto-trigger validation when STABLE reached
    useEffect(() => {
        if (dropPhase === 'STABLE' && viewMode === 'validation' && posCountdown === null) {
            handleValidatePosition();
        }
    }, [dropPhase, viewMode]);


    const getStatus = () => {
        const roll = displayedRoll;
        const pitch = displayedPitch;
        let yawDev = displayedYaw;
        if (yawDev > 180) yawDev = Math.abs(yawDev - 360); 
        
        if (Math.abs(roll) > 135) return { code: 'INVERTED', status: 'INVERTED', color: 'text-alert-500', bg: 'bg-alert-900/30', msg: 'Anchor is FLIPPED!', isSafe: false };
        if (roll < config.minRoll || roll > config.maxRoll) return { code: 'SIDE', status: 'SIDE TILT', color: 'text-orange-500', bg: 'bg-orange-900/30', msg: `Roll ${roll.toFixed(0)}° outside limits`, isSafe: false };
        if (pitch < config.minPitch || pitch > config.maxPitch) return { code: 'UNSTABLE', status: 'UNSTABLE', color: 'text-orange-500', bg: 'bg-orange-900/30', msg: `Pitch ${pitch.toFixed(0)}° outside limits`, isSafe: false };
        if (viewMode !== 'validation' && yawDev > config.maxYaw) return { code: 'ROTATED', status: 'ROTATED', color: 'text-yellow-500', bg: 'bg-yellow-900/30', msg: `Yaw deviation > ${config.maxYaw}°`, isSafe: false };

        return { code: 'GOOD', status: 'GOOD SET', color: 'text-safe-500', bg: 'bg-safe-900/30', msg: 'Anchor position is valid', isSafe: true };
    };

    const currentStatus = getStatus();

    const handleCalibrate = () => {
        onCalibrate('mechanical', displayedPitch, displayedRoll, displayedYaw);
        setShowCalibSuccess(true);
        setSmartAnchorState(prev => ({ ...prev, isCalibrated: true }));
        setCalibCountdown(3);
        const timer = setInterval(() => {
            setCalibCountdown(prev => {
                if (prev !== null && prev > 1) return prev - 1;
                clearInterval(timer);
                return null;
            });
        }, 1000);
        setTimeout(() => {
            setShowCalibSuccess(false);
            onNavigate(AppTab.POSITIONING);
        }, 3000);
    };

    const handleValidatePosition = () => {
        onCalibrate('monitoring', displayedPitch, displayedRoll, displayedYaw);
        setSmartAnchorState(prev => ({ ...prev, isPositioned: true }));
        
        // 10 second countdown before monitoring
        setPosCountdown(10);
        const timer = setInterval(() => {
            setPosCountdown(prev => {
                if (prev !== null && prev > 1) return prev - 1;
                clearInterval(timer);
                return null;
            });
        }, 1000);

        setTimeout(() => {
            setSmartAnchorState(prev => ({ ...prev, isMonitoring: true }));
            onNavigate(AppTab.MONITORING);
            setPosCountdown(null);
        }, 10000);
    };

    const stopMonitoring = () => {
        setSmartAnchorState(prev => ({ ...prev, isMonitoring: false }));
        setDropPhase('IDLE');
        if (isRecording && onStopRecording) {
            onStopRecording();
        }
    };

    // Helper for simulation button styles
    const simBtnStyle = (isActive: boolean) => 
        `px-2 py-3 rounded-lg text-[10px] font-bold border transition-all active:scale-95 flex flex-col items-center justify-center gap-1 flex-1 ${isActive 
            ? 'bg-ocean-500 text-white border-ocean-400 ring-2 ring-ocean-500/30' 
            : 'bg-ocean-900 text-ocean-400 border-ocean-700 hover:bg-ocean-800'}`;


    // --- UNIFIED EMPTY STATE COMPONENT ---
    const RenderEmptyState = ({ 
        icon: Icon, 
        title, 
        description, 
        targetTab, 
        btnLabel,
        isSettingsTarget
    }: { 
        icon: React.ElementType, 
        title: string, 
        description: string, 
        targetTab: AppTab, 
        btnLabel: string,
        isSettingsTarget?: boolean
    }) => {
        const isConnected = sensorData.isConnected;

        const handleAction = () => {
            if (isSettingsTarget && onConnectRequest) {
                onConnectRequest();
            } else {
                onNavigate(targetTab);
            }
        };

        return (
            <div className="flex flex-col h-full p-6 items-center justify-center text-center space-y-8 animate-in fade-in zoom-in-95 duration-300">
                <div className="p-6 bg-ocean-800 rounded-full border border-ocean-700 shadow-[0_0_30px_rgba(56,189,248,0.1)]">
                    <Icon className="w-16 h-16 text-gray-500" />
                </div>
                
                <div className="space-y-6 w-full max-w-sm">
                    <h3 className="text-2xl font-bold text-white">{title}</h3>
                    
                    <div className="bg-ocean-800/50 p-4 rounded-xl border border-ocean-700 w-full">
                        <div className="flex items-center justify-between text-xs gap-1">
                             <div className={`flex flex-col items-center gap-1 ${isConnected ? 'text-safe-500' : 'text-orange-500 font-bold'}`}>
                                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${isConnected ? 'border-safe-500 bg-safe-900/20' : 'border-orange-500 bg-orange-900/20'}`}>
                                    {isConnected ? <CheckCircle2 className="w-3 h-3"/> : '1'}
                                </div>
                                <span className="text-[10px]">Connect</span>
                             </div>
                             <div className={`h-0.5 flex-1 mx-1 ${isConnected ? 'bg-safe-500/50' : 'bg-ocean-700'}`}></div>
                             
                             <div className={`flex flex-col items-center gap-1 ${smartAnchorState.isCalibrated ? 'text-safe-500' : (isConnected && !smartAnchorState.isCalibrated ? 'text-orange-500 font-bold' : 'text-gray-600')}`}>
                                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${smartAnchorState.isCalibrated ? 'border-safe-500 bg-safe-900/20' : (isConnected && !smartAnchorState.isCalibrated ? 'border-orange-500 bg-orange-900/20' : 'border-ocean-700 bg-ocean-800')}`}>
                                    {smartAnchorState.isCalibrated ? <CheckCircle2 className="w-3 h-3"/> : '2'}
                                </div>
                                <span className="text-[10px]">Calib</span>
                             </div>
                             <div className={`h-0.5 flex-1 mx-1 ${smartAnchorState.isCalibrated ? 'bg-safe-500/50' : 'bg-ocean-700'}`}></div>

                             <div className={`flex flex-col items-center gap-1 ${smartAnchorState.isPositioned ? 'text-safe-500' : (smartAnchorState.isCalibrated && !smartAnchorState.isPositioned ? 'text-orange-500 font-bold' : 'text-gray-600')}`}>
                                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${smartAnchorState.isPositioned ? 'border-safe-500 bg-safe-900/20' : (smartAnchorState.isCalibrated && !smartAnchorState.isPositioned ? 'border-orange-500 bg-orange-900/20' : 'border-ocean-700 bg-ocean-800')}`}>
                                    {smartAnchorState.isPositioned ? <CheckCircle2 className="w-3 h-3"/> : '3'}
                                </div>
                                <span className="text-[10px]">Pos</span>
                             </div>
                             <div className={`h-0.5 flex-1 mx-1 ${smartAnchorState.isPositioned ? 'bg-safe-500/50' : 'bg-ocean-700'}`}></div>

                             <div className={`flex flex-col items-center gap-1 ${smartAnchorState.isMonitoring ? 'text-safe-500' : (smartAnchorState.isPositioned && !smartAnchorState.isMonitoring ? 'text-orange-500 font-bold' : 'text-gray-600')}`}>
                                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${smartAnchorState.isMonitoring ? 'border-safe-500 bg-safe-900/20' : (smartAnchorState.isPositioned && !smartAnchorState.isMonitoring ? 'border-orange-500 bg-orange-900/20' : 'border-ocean-700 bg-ocean-800')}`}>
                                    {smartAnchorState.isMonitoring ? <CheckCircle2 className="w-3 h-3"/> : '4'}
                                </div>
                                <span className="text-[10px]">Monitor</span>
                             </div>
                        </div>
                    </div>

                    <p className="text-ocean-300 text-sm leading-relaxed px-4">
                       {description}
                    </p>
                </div>

                <button 
                    onClick={handleAction} 
                    className="bg-ocean-500 hover:bg-ocean-400 text-white px-8 py-4 rounded-xl font-bold text-lg shadow-lg transition-all active:scale-95 flex items-center gap-2 w-full max-w-xs justify-center"
                >
                    {btnLabel} <ChevronRight className="w-5 h-5" />
                </button>
            </div>
        );
    };


    // --- CALIBRATION VIEW ---
    if (viewMode === 'calibration') {
        if (!sensorData.isConnected) {
            return <RenderEmptyState 
                icon={Ruler} 
                title="Sensor Disconnected" 
                description="To calibrate your anchor, you must first pair your Bluetooth sensor in Settings." 
                targetTab={AppTab.SETTINGS}
                btnLabel="Setup Connection"
                isSettingsTarget={true}
            />;
        }

        return (
            <div className="flex flex-col h-full p-4 space-y-3 overflow-y-auto pb-24 animate-in fade-in">
                <div className="flex items-center justify-between px-2">
                    <h2 className="text-2xl font-bold text-white flex items-center gap-2"><Ruler className="w-6 h-6 text-ocean-500" /> Calibration</h2>
                    <span className="text-xs text-ocean-400">Step 2/4</span>
                </div>

                <button 
                    onClick={handleCalibrate} 
                    disabled={showCalibSuccess}
                    className="w-full py-3 rounded-xl font-bold text-lg shadow-lg bg-ocean-500 hover:bg-ocean-400 text-white transition-colors flex items-center justify-center gap-2"
                >
                    <Gauge className="w-5 h-5" /> Set Zero (Tare)
                </button>

                <div className="bg-ocean-800 rounded-2xl border border-ocean-700 p-4 flex flex-col items-center flex-1 relative overflow-hidden">
                    {showCalibSuccess ? (
                        <div className="absolute inset-0 bg-safe-900/90 flex flex-col items-center justify-center z-10 animate-in fade-in">
                            <CheckCircle className="w-20 h-20 text-safe-500 mb-4" />
                            <h3 className="text-2xl font-bold text-white">Calibrated!</h3>
                            <p className="text-safe-200 mt-2">Redirecting in {calibCountdown}s...</p>
                        </div>
                    ) : (
                         <div className="w-full h-full flex flex-col">
                            <div className="mb-4 flex justify-center flex-shrink-0">
                                <RefreshCw className="w-10 h-10 text-ocean-500 animate-spin-slow" />
                            </div>
                            <div className="bg-ocean-900/50 p-3 rounded-xl border border-ocean-700/50 mb-4 flex-shrink-0">
                                <h4 className="text-xs font-bold text-ocean-300 uppercase mb-2 flex items-center gap-2">
                                    <Info className="w-4 h-4" /> Instructions
                                </h4>
                                <ul className="text-xs text-gray-300 space-y-2 list-disc pl-4 leading-relaxed">
                                    <li>Lay the anchor flat (horizontal).</li>
                                    <li>Mount sensor on the anchor shank.</li>
                                    <li>Secure the retrieval line.</li>
                                    <li>Verify raw angles below are stable.</li>
                                    <li>Tap <strong>Set Zero</strong> above to calibrate.</li>
                                </ul>
                            </div>
                            <div className="grid grid-cols-2 gap-2 w-full mt-auto">
                                <div className="text-center p-2 bg-ocean-900 rounded border border-ocean-700/30">
                                    <span className="text-[10px] text-ocean-400 block font-bold">RAW PITCH</span>
                                    <span className="font-mono font-bold text-white text-lg">{smoothPitch.toFixed(0)}°</span>
                                </div>
                                <div className="text-center p-2 bg-ocean-900 rounded border border-ocean-700/30">
                                    <span className="text-[10px] text-ocean-400 block font-bold">RAW ROLL</span>
                                    <span className="font-mono font-bold text-white text-lg">{smoothRoll.toFixed(0)}°</span>
                                </div>
                            </div>
                         </div>
                    )}
                </div>
            </div>
        );
    }

    // --- MONITORING VIEW ---
    if (viewMode === 'monitoring') {
        // CASE 1: NOT CONNECTED
        if (!sensorData.isConnected) {
            return <RenderEmptyState 
                icon={Activity} 
                title="Sensor Disconnected" 
                description="To monitor dragging risks, you must first pair your Bluetooth sensor in Settings." 
                targetTab={AppTab.SETTINGS}
                btnLabel="Setup Connection"
                isSettingsTarget={true}
            />;
        }

        // CASE 2: CONNECTED BUT NOT CALIBRATED
        if (!smartAnchorState.isCalibrated) {
             return <RenderEmptyState 
                icon={Activity} 
                title="Calibration Required" 
                description="Your sensor is paired. Now, please calibrate it (Tare) to ensure accurate positioning data." 
                targetTab={AppTab.CALIBRATION}
                btnLabel="Go to Calibration"
            />;
        }

        // CASE 3: CONNECTED BUT NOT ACTIVE
        if (!smartAnchorState.isMonitoring) {
             return <RenderEmptyState 
                icon={Activity} 
                title="Monitoring Inactive" 
                description="The sensor is connected, but the anchor drop sequence has not been validated." 
                targetTab={AppTab.POSITIONING}
                btnLabel="Go to Positioning"
            />;
        }

        // Calculate Deviations relative to Reference
        const devPitch = Math.abs(displayedPitch - config.monitoringReference.pitch);
        const devRoll = Math.abs(displayedRoll - config.monitoringReference.roll);
        let devYaw = Math.abs(displayedYaw - (config.monitoringReference.yaw || 0));
        if (devYaw > 180) devYaw = 360 - devYaw;

        const { effectiveLimits, activeDrivers, vigilanceMultiplier, hwFactor, scopeMultiplier } = riskContext;

        // Helper for Progress Bar
        const MotionBar = ({ label, icon: Icon, current, max }: { label: string, icon: any, current: number, max: number }) => {
            const pct = Math.min(100, (current / max) * 100);
            let color = "bg-safe-500";
            if (pct > 100) color = "bg-alert-500 animate-pulse";
            else if (pct > 75) color = "bg-orange-500";
            else if (pct > 50) color = "bg-yellow-500";
            
            return (
                <div className="flex flex-col gap-1 w-full">
                    <div className="flex justify-between items-end">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-ocean-300">
                             <Icon className="w-3 h-3" /> {label}
                        </div>
                        <div className="font-mono text-xs">
                             <span className={`font-bold ${pct > 100 ? 'text-red-500' : 'text-white'}`}>{current.toFixed(0)}°</span>
                             <span className="text-ocean-500 text-[10px]"> / {max.toFixed(0)}°</span>
                        </div>
                    </div>
                    <div className="h-1.5 w-full bg-ocean-900 rounded-full overflow-hidden">
                        <div className={`h-full ${color} transition-all duration-300`} style={{ width: `${pct}%` }}></div>
                    </div>
                </div>
            );
        };

        return (
            // INCREASED PADDING BOTTOM TO 36 (144px) TO AVOID NAV OVERLAP
            // REDUCED VERTICAL SPACE TO 3
            <div className="flex flex-col h-full p-4 space-y-3 overflow-y-auto pb-36 animate-in fade-in duration-300">
                 <div className="flex items-center justify-between px-2">
                    <h2 className="text-2xl font-bold text-white flex items-center gap-2"><Activity className="w-6 h-6 text-ocean-500" /> Monitoring</h2>
                    <div className="flex gap-2"><span className="flex items-center gap-1 text-xs font-mono px-2 py-1 rounded bg-safe-900 text-safe-500">ACTIVE <Wifi className="w-3 h-3 animate-pulse" /></span></div>
                </div>

                <div className="flex flex-1 gap-3 min-h-0">
                    
                    {/* LEFT: LED RISK GAUGE */}
                    <div className="w-16 flex flex-col items-center gap-1 relative py-1">
                        {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((level) => {
                            const isActive = riskScore === level;
                            let baseColor = "bg-safe-500";
                            if (level >= 9) baseColor = "bg-alert-500"; 
                            else if (level >= 7) baseColor = "bg-orange-500";
                            else if (level >= 5) baseColor = "bg-yellow-500";
                            else if (level >= 3) baseColor = "bg-blue-400";
                            
                            return (
                                <div 
                                    key={level} 
                                    className={`
                                        w-full flex-1 rounded border border-black/20 flex items-center justify-center transition-all duration-300 relative
                                        ${isActive 
                                            ? `${baseColor} shadow-[0_0_15px_rgba(255,255,255,0.4)] z-10 scale-110 border-white/30` 
                                            : `${baseColor} opacity-20 scale-95`
                                        }
                                    `}
                                >
                                    {isActive && (
                                        <>
                                            <span className="text-white font-black text-2xl drop-shadow-md">{level}</span>
                                            <div className="absolute -left-3 top-1/2 -translate-y-1/2">
                                                <div className="w-0 h-0 border-t-[6px] border-t-transparent border-b-[6px] border-b-transparent border-l-[8px] border-l-white drop-shadow-md"></div>
                                            </div>
                                        </>
                                    )}
                                </div>
                            )
                        })}
                        <span className="text-[10px] text-ocean-400 font-bold uppercase mt-1 tracking-wider">Risk</span>
                    </div>

                    {/* RIGHT: MAIN CONTENT */}
                    <div className={`flex-1 flex flex-col gap-3 ${alarmTriggered ? 'animate-pulse' : ''}`}>
                        
                        {/* 1. Main Info Window - Compacted */}
                        <div className={`bg-ocean-800 rounded-2xl border p-3 relative overflow-hidden flex flex-col justify-start ${alarmTriggered ? 'border-red-500 bg-alert-900/20' : 'border-ocean-700'}`}>
                            {alarmTriggered && (
                                <div className="absolute inset-0 z-50 bg-alert-900/90 flex flex-col items-center justify-center text-center p-2 animate-in fade-in">
                                    <ShieldAlert className="w-12 h-12 text-red-500 mb-2 animate-bounce" />
                                    <h3 className="text-xl font-black text-white uppercase tracking-widest">DRAG!</h3>
                                    <p className="text-white text-sm">{currentStatus.msg}</p>
                                </div>
                            )}
                            
                            {/* Header Stats: TREND (COMPACT) */}
                            <div className="text-center border-b border-ocean-700/50 pb-2 mb-2">
                                <p className="text-[10px] font-bold text-ocean-400 uppercase tracking-wider mb-0.5">Current Trend</p>
                                <div className={`flex items-center justify-center gap-2 text-2xl font-black uppercase ${riskTrend === 'rising' ? 'text-alert-400' : 'text-safe-400'}`}>
                                    {riskTrend === 'rising' ? <ArrowDown className="w-6 h-6 rotate-180" /> : <ArrowDown className="w-6 h-6" />}
                                    {riskTrend === 'rising' ? 'WORSENING' : 'STABLE'}
                                </div>
                            </div>

                            {/* Middle: Motion Dashboard (COMPACT) */}
                            <div className="flex flex-col gap-2 mb-2 px-1">
                                <p className="text-[9px] font-bold text-ocean-500 uppercase tracking-wider text-center">Motion Monitor (Current / Max Allowed)</p>
                                
                                <MotionBar label="PITCH" icon={MoveVertical} current={devPitch} max={effectiveLimits.pitch} />
                                <MotionBar label="ROLL" icon={MoveHorizontal} current={devRoll} max={effectiveLimits.roll} />
                                <MotionBar label="YAW" icon={RotateCw} current={devYaw} max={effectiveLimits.yaw} />
                                
                                {vigilanceMultiplier > 1.0 && (
                                    <p className="text-[9px] text-orange-400 text-center italic mt-0.5">
                                        Note: Limits reduced by {vigilanceMultiplier}x due to High Risk.
                                    </p>
                                )}
                            </div>

                            {/* Bottom: Active Contributors (Clearer) */}
                            <div className="flex-1 flex flex-col justify-end border-t border-ocean-700/50 pt-1">
                                <p className="text-[9px] font-bold text-ocean-500 uppercase tracking-wider mb-1 text-center">Active Risk Factors</p>
                                {activeDrivers.length > 0 ? (
                                    <div className="flex flex-wrap gap-1 justify-center">
                                        {activeDrivers.map((d, i) => (
                                            <span key={i} className={`px-2 py-1 rounded-full text-[10px] font-bold border ${d.color} ${d.border} bg-ocean-900/50 shadow-sm`}>
                                                {d.name}
                                            </span>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="text-center text-xs font-bold text-safe-500 bg-safe-900/20 py-1.5 rounded-lg border border-safe-500/20">
                                        <CheckCircle2 className="w-3 h-3 inline mr-1" /> No Significant Risk Factors
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* 2. Factor Summary (UPDATED: Identical Style to Last Log, Compact Grid) */}
                        <div className="bg-ocean-800 border border-ocean-700 p-3 rounded-xl flex flex-col gap-2 shadow-sm">
                            <div className="flex items-center justify-between border-b border-ocean-700/50 pb-2 mb-1">
                                <div className="flex items-center gap-2">
                                    <Sigma className="w-4 h-4 text-ocean-400" />
                                    <h4 className="text-xs font-bold text-ocean-400 uppercase">Algorithm Factors</h4>
                                </div>
                            </div>

                            {/* Compact Grid Layout */}
                            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[10px]">
                                 <div className="flex justify-between items-center"><span className="text-ocean-300 font-bold uppercase">Wind</span><span className="font-mono text-blue-300">+{config.calculatedWindFactor}</span></div>
                                 <div className="flex justify-between items-center"><span className="text-ocean-300 font-bold uppercase">Seabed</span><span className="font-mono text-yellow-300">x{config.calculatedSeabedFactor.toFixed(1)}</span></div>
                                 
                                 <div className="flex justify-between items-center"><span className="text-ocean-300 font-bold uppercase">Depth</span><span className="font-mono text-cyan-300">+{config.calculatedDepthFactor}</span></div>
                                 <div className="flex justify-between items-center"><span className="text-ocean-300 font-bold uppercase">Scope</span><span className="font-mono text-orange-300">x{scopeMultiplier.toFixed(1)}</span></div>
                                 
                                 <div className="flex justify-between items-center"><span className="text-ocean-300 font-bold uppercase">Swell</span><span className="font-mono text-indigo-300">+{config.calculatedSwellFactor}</span></div>
                                 <div className="flex justify-between items-center"><span className="text-ocean-300 font-bold uppercase">Gear</span><span className="font-mono text-purple-300">x{hwFactor.toFixed(1)}</span></div>
                            </div>
                        </div>

                        {/* 3. Recording Summary (Last Log) - UPDATED: Full filename visibility */}
                        {recordingStats && !isRecording && (
                            <div className="bg-safe-900/20 border border-safe-500/30 p-3 rounded-xl animate-in fade-in slide-in-from-top-4 shadow-sm">
                                <div className="flex flex-col gap-2 mb-2">
                                    <div className="flex items-center gap-2">
                                         <FileText className="w-4 h-4 text-safe-400" />
                                         <h4 className="text-xs font-bold text-safe-400 uppercase">Last Log</h4>
                                    </div>
                                    {/* Filename on new line for full width */}
                                    <div className="text-[10px] text-gray-300 font-mono break-all bg-black/20 p-1.5 rounded border border-white/5 leading-tight">
                                        {recordingStats.fileName}
                                    </div>
                                </div>
                                
                                <div className="flex justify-between items-center px-1 text-xs font-mono text-white">
                                     <span><span className="text-ocean-400 font-sans font-bold mr-1">Time:</span>{Math.round(parseFloat(recordingStats.duration))}s</span>
                                     <span><span className="text-ocean-400 font-sans font-bold mr-1">Freq:</span>{recordingStats.frequency}Hz</span>
                                     <span><span className="text-ocean-400 font-sans font-bold mr-1">Pts:</span>{recordingStats.points}</span>
                                </div>
                            </div>
                        )}
                        
                        {/* MANUAL RECORDING CONTROL */}
                        {!isRecording && !recordingStats && (
                             <button 
                                onClick={onStartRecording}
                                className="w-full py-2 rounded-xl font-bold text-sm bg-ocean-800 text-ocean-300 border border-ocean-700 hover:bg-ocean-700 flex justify-center items-center gap-2 transition-all active:scale-95"
                            >
                                <CircleDot className="w-4 h-4 text-red-500" /> Manual Record Start
                            </button>
                        )}

                        {isRecording && (
                            <button 
                                onClick={onStopRecording}
                                className="w-full py-2 rounded-xl font-bold text-sm bg-red-600 text-white shadow hover:bg-red-500 flex justify-center items-center gap-2 animate-pulse transition-all active:scale-95"
                            >
                                <Download className="w-4 h-4" /> Stop & Save Log
                            </button>
                        )}

                        <button onClick={stopMonitoring} className="w-full py-3 rounded-xl font-bold text-sm shadow-lg bg-ocean-700 border border-ocean-600 text-white hover:bg-ocean-600 flex justify-center items-center gap-2">
                            <Unlock className="w-4 h-4" /> Stop Monitoring
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // --- VALIDATION (POSITIONING) VIEW ---
    // CASE 1: NOT CONNECTED
    if (!sensorData.isConnected) {
        return <RenderEmptyState 
            icon={Anchor} 
            title="Sensor Disconnected" 
            description="To track the anchor drop sequence, you must first pair your Bluetooth sensor in Settings." 
            targetTab={AppTab.SETTINGS}
            btnLabel="Setup Connection"
            isSettingsTarget={true}
        />;
    }

    // CASE 2: CONNECTED BUT NOT CALIBRATED
    if (!smartAnchorState.isCalibrated) {
         return <RenderEmptyState 
            icon={Anchor} 
            title="Calibration Required" 
            description="Your sensor is paired. Now, please calibrate it (Tare) to ensure accurate positioning data." 
            targetTab={AppTab.CALIBRATION}
            btnLabel="Go to Calibration"
        />;
    }
    
    // UPDATED STEPS: Removed 'Start Sequence' (IDLE state is purely logical now)
    const steps = [
        { id: 'DAVIER', phase: 'DAVIER', label: 'Anchor on Davier', icon: Anchor, desc: 'Anchor on bow roller' },
        { id: 'DROPPING', phase: 'DROPPING', label: 'Anchor Down', icon: ArrowDown, desc: 'Dropping to seabed' },
        { id: 'ON_SOIL', phase: 'ON_SOIL', label: 'Anchor on Soil', icon: ArrowDownToLine, desc: 'Touchdown detected' },
        { id: 'SETTING', phase: 'SETTING', label: 'Anchor Drag', icon: Ship, desc: 'Digging in (Reverse)' },
        { id: 'STABLE', phase: 'STABLE', label: 'Anchor Stable', icon: CheckCircle2, desc: 'Position secured' }
    ];

    const getStepStatus = (stepPhase: DropPhase) => {
        const order = ['IDLE', 'DAVIER', 'DROPPING', 'ON_SOIL', 'SETTING', 'STABLE'];
        const currentIdx = order.indexOf(dropPhase);
        const stepIdx = order.indexOf(stepPhase);
        
        // SPECIAL LOGIC: When in IDLE (waiting for "Ready to Go"), we assume the physical anchor
        // is ALREADY on the Davier. So visually, "Anchor on Davier" should be ACTIVE
        // to show sensor values, even if the auto-logic hasn't started yet.
        if (dropPhase === 'IDLE' && stepPhase === 'DAVIER') return 'active';

        if (dropPhase === stepPhase) return 'active';
        if (currentIdx > stepIdx) return 'completed';
        return 'pending';
    };

    const absPitch = Math.abs(displayedPitch);
    const absRoll = Math.abs(displayedRoll);
    const isAlignedWithCalibration = absPitch < 5 && absRoll < 5;

    // Calculate Total Elapsed Time since Ready to Go
    // CHANGED: Use Math.floor to show integer seconds instead of fixed(1) which showed milliseconds/decimal.
    const totalElapsedSec = sequenceStartTime ? Math.floor((currentTimerTick - sequenceStartTime) / 1000).toString() : "0";

    return (
        <div className="flex flex-col h-full p-4 space-y-4 overflow-y-auto pb-24 animate-in fade-in duration-300">
             <div className="flex items-center justify-between px-2 flex-shrink-0">
                <h2 className="text-2xl font-bold text-white flex items-center gap-2"><Bluetooth className="w-6 h-6 text-ocean-500" /> Positioning</h2>
                <div className="flex gap-2"><span className={`flex items-center gap-1 text-xs font-mono px-2 py-1 rounded ${sensorData.isConnected ? 'bg-safe-900 text-safe-500' : 'bg-ocean-800 text-gray-400'}`}>{sensorData.isConnected ? (config.bluetoothDeviceName || 'LINKED') : 'OFFLINE'} <Wifi className="w-3 h-3" /></span></div>
            </div>

            {/* READY TO GO CONTROL GROUP - MOVED OUTSIDE CONTAINER */}
            {dropPhase === 'IDLE' && (
                <div className="flex w-full gap-2 animate-in slide-in-from-top duration-300">
                    <button 
                        onClick={() => {
                            setDropPhase('DAVIER');
                            setSequenceStartTime(Date.now());
                            // Conditionally Start Recording based on Toggle State
                            if (isRecordEnabled && onStartRecording) {
                                onStartRecording();
                            }
                        }}
                        className="flex-1 py-3 rounded-xl font-bold text-lg shadow-lg bg-ocean-500 hover:bg-ocean-400 text-white transition-colors flex items-center justify-center gap-2"
                    >
                        <Play className="w-5 h-5 fill-current" /> Ready to Go
                    </button>

                    <button 
                        onClick={() => setIsRecordEnabled(!isRecordEnabled)}
                        className={`w-1/4 rounded-xl font-bold text-xs flex flex-col items-center justify-center border transition-all ${
                            isRecordEnabled 
                            ? 'bg-safe-900/30 text-safe-400 border-safe-500/50' 
                            : 'bg-ocean-800 text-gray-500 border-ocean-700'
                        }`}
                    >
                        {isRecordEnabled ? <CircleDot className="w-4 h-4 mb-1" /> : <CircleOff className="w-4 h-4 mb-1" />}
                        {isRecordEnabled ? "REC ON" : "REC OFF"}
                    </button>
                </div>
            )}

            {/* SEQUENCE CONTAINER */}
            <div className="bg-ocean-800 rounded-2xl border border-ocean-700 shadow-lg p-2 flex flex-col relative">
                <div className="space-y-0 relative pb-2">
                    {/* Connecting Line */}
                    <div className="absolute left-[19px] top-6 bottom-6 w-0.5 bg-ocean-700 -z-0"></div>

                    {steps.map((step, idx) => {
                        const status = getStepStatus(step.phase as DropPhase);
                        const isActive = status === 'active';
                        const isCompleted = status === 'completed';
                        
                        return (
                            <div 
                                key={step.id} 
                                className={`flex items-center gap-4 p-3 rounded-xl transition-all duration-500 ${isActive ? 'bg-ocean-700/50 scale-105 shadow-md border border-ocean-600 my-2' : 'opacity-60'}`}
                            >
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 z-10 flex-shrink-0 transition-colors duration-300 ${
                                    isActive ? 'bg-ocean-600 border-ocean-400 text-white animate-pulse' : 
                                    isCompleted ? 'bg-safe-900 border-safe-500 text-safe-500' : 
                                    'bg-ocean-900 border-ocean-700 text-gray-500'
                                }`}>
                                    {isCompleted ? <CheckCircle2 className="w-5 h-5" /> : <step.icon className="w-5 h-5" />}
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-center">
                                        <h4 className={`font-bold text-sm truncate ${isActive ? 'text-white' : (isCompleted ? 'text-safe-500' : 'text-gray-400')}`}>
                                            {step.label}
                                        </h4>
                                        {/* Status Info specifically for auto phases */}
                                        {isActive && step.phase === 'SETTING' && (
                                            <div className="flex items-center gap-2 ml-2">
                                                {stableStartTime ? (
                                                        <span className="text-xs text-safe-400 font-mono font-bold flex items-center gap-1">
                                                        <Timer className="w-3 h-3 animate-spin-slow" />
                                                        {20 - Math.floor((Date.now() - stableStartTime)/1000)}s
                                                        </span>
                                                ) : (
                                                        <span className="text-[10px] text-orange-400 font-bold uppercase animate-pulse border border-orange-500/50 px-1.5 py-0.5 rounded bg-orange-900/30">
                                                        Digging (Unstable)
                                                        </span>
                                                )}
                                            </div>
                                        )}
                                        {isActive && step.phase === 'ON_SOIL' && (
                                                <span className="text-xs text-ocean-400 font-mono ml-2">
                                                Auto in {5 - Math.floor((Date.now() - phaseStartTime)/1000)}s
                                                </span>
                                        )}
                                    </div>
                                    <p className="text-xs text-gray-500 truncate">{step.desc}</p>
                                </div>

                                {isActive && (
                                    <div className="flex flex-col gap-1 ml-2 p-1.5 bg-ocean-900/50 rounded border border-ocean-700/50 shadow-inner min-w-[60px]">
                                        <div className="text-center border-b border-ocean-700/50 pb-1 mb-0.5">
                                            <span className="font-mono text-[10px] font-bold text-safe-400 block">{totalElapsedSec}s</span>
                                        </div>
                                        <div className="flex items-center justify-between gap-1">
                                            <span className="text-[9px] text-ocean-400 font-bold">P</span>
                                            <span className={`font-mono text-[10px] font-bold ${Math.abs(displayedPitch) > 45 ? 'text-orange-500' : 'text-white'}`}>
                                                {displayedPitch.toFixed(0)}°
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between gap-1">
                                            <span className="text-[9px] text-ocean-400 font-bold">R</span>
                                            <span className="font-mono text-[10px] font-bold text-white">
                                                {displayedRoll.toFixed(0)}°
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {dropPhase === 'STABLE' && (
                <div className="bg-ocean-800 rounded-xl border border-ocean-700 p-4 shadow-xl animate-in slide-in-from-bottom duration-500 flex-shrink-0">
                    <div className="flex items-center gap-3 mb-3 border-b border-ocean-700/50 pb-2">
                        <ClipboardCheck className={`w-6 h-6 ${isAlignedWithCalibration ? 'text-safe-500' : 'text-orange-500'}`} />
                        <div>
                            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Anchoring Report</h3>
                            <p className={`text-xs font-bold ${isAlignedWithCalibration ? 'text-safe-400' : 'text-orange-400'}`}>
                                {isAlignedWithCalibration ? "Perfect Match with Calibration" : "Check Anchor Alignment"}
                            </p>
                        </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2 text-center">
                        <div className={`p-2 rounded-lg border ${Math.abs(displayedPitch) < 5 ? 'bg-safe-900/20 border-safe-500/30 text-safe-400' : 'bg-orange-900/20 border-orange-500/30 text-orange-400'}`}>
                            <span className="block text-[9px] font-bold uppercase opacity-70 mb-1">PITCH DIFF</span>
                            <span className="block text-xl font-mono font-bold">{displayedPitch > 0 ? '+' : ''}{displayedPitch.toFixed(0)}°</span>
                        </div>
                        <div className={`p-2 rounded-lg border ${Math.abs(displayedRoll) < 5 ? 'bg-safe-900/20 border-safe-500/30 text-safe-400' : 'bg-orange-900/20 border-orange-500/30 text-orange-400'}`}>
                            <span className="block text-[9px] font-bold uppercase opacity-70 mb-1">ROLL DIFF</span>
                            <span className="block text-xl font-mono font-bold">{displayedRoll > 0 ? '+' : ''}{displayedRoll.toFixed(0)}°</span>
                        </div>
                    </div>
                    {posCountdown !== null && (
                         <div className="mt-3 text-center text-xs text-ocean-400 animate-pulse">
                            Auto-switch to Monitoring in {posCountdown}s...
                         </div>
                    )}
                </div>
            )}
            
            {/* SIMULATOR CONTROLS - RESTORED AT BOTTOM (BUTTONS ONLY) */}
            {config.sensorType === 'SIMULATOR' && (
                <div className="bg-ocean-800 p-4 rounded-xl border border-ocean-700 space-y-4 animate-in slide-in-from-bottom mt-auto">
                    <div className="flex justify-between items-center mb-2">
                        <h3 className="text-xs font-bold text-ocean-400 uppercase tracking-wider flex items-center gap-2">
                            <Gamepad2 className="w-4 h-4" /> Simulator Controls
                        </h3>
                    </div>

                    <div className="grid grid-cols-4 gap-2">
                        <button onClick={() => setSimOverride({pitch: 0, roll: 0, noise: false})} className={simBtnStyle(simOverride?.pitch === 0 && !simOverride?.noise)}>
                            FLAT (0°)
                        </button>
                        <button onClick={() => setSimOverride({pitch: 75, roll: 0, noise: false})} className={simBtnStyle(simOverride?.pitch === 75)}>
                            DROP (75°)
                        </button>
                        <button onClick={() => setSimOverride({pitch: 20, roll: 0, noise: false})} className={simBtnStyle(simOverride?.pitch === 20)}>
                            SOIL (20°)
                        </button>
                        <button onClick={() => setSimOverride(prev => ({...prev || {pitch: 0, roll: 0}, noise: !prev?.noise}))} className={`${simBtnStyle(!!simOverride?.noise)} ${simOverride?.noise ? 'text-orange-500 border-orange-500 bg-orange-900/20' : ''}`}>
                            {simOverride?.noise ? 'SHAKE ON' : 'SHAKE OFF'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
export default SmartAnchor;
