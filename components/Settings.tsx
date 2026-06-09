
import React, { useState, useEffect, useRef } from 'react';
import { Settings as SettingsIcon, Info, Rotate3D, MoveVertical, MoveHorizontal, Bluetooth, ChevronRight, ArrowLeft, Check, Loader2, Layers, Sliders, Calculator, CloudLightning, Gauge, Scale, ArrowDown, Power, Link, MonitorSmartphone, Smartphone, Box, Cpu, ShieldAlert, Weight, Wind, Anchor, Waves, Sigma, RefreshCw, CheckCircle } from 'lucide-react';
import { AnchorConfig, SensorType, RiskParameters, BoatData, ChainData, AppTab, Submenu } from '../types';

interface SettingsProps {
    config: AnchorConfig;
    setConfig: React.Dispatch<React.SetStateAction<AnchorConfig>>;
    onConnect: () => Promise<void>;
    onDisconnect: () => void;
    isConnected: boolean;
    onNavigate: (tab: AppTab) => void;
    boatData: BoatData;
    windSpeed: number;
    swellHeight: number;
    depth: number;
    seabedType: string;
    chainData: ChainData;
    activeSubmenu: Submenu;
    setActiveSubmenu: React.Dispatch<React.SetStateAction<Submenu>>;
}

// 3D EXTRUDED ANCHOR - PRECISE SPADE SILHOUETTE
const Anchor3D = () => {
    // Canvas 100x160
    const shankPath = "M 46 30 L 47 145 L 53 145 L 54 30 Z"; 
    const eyePath = "M 50 138 m -3, 0 a 3,3 0 1,0 6,0 a 3,3 0 1,0 -6,0";
    const bladePath = `
        M 50 10       
        L 90 40       
        L 54 90       
        L 46 90       
        L 10 40       
        L 50 10       
        Z
    `;
    const bladeDetail = "M 15 42 L 50 80 L 85 42";
    const layers = 20; 
    const spacing = 1.4; 

    return (
        <div className="relative w-full h-full flex items-center justify-center" style={{ transformStyle: 'preserve-3d' }}>
            <div className="relative w-[220px] h-[220px]" style={{ transformStyle: 'preserve-3d', transform: 'translateY(20px)' }}>
                {Array.from({ length: layers }).map((_, i) => {
                    const z = (i - layers / 2) * spacing;
                    const isFace = i === 0 || i === layers - 1;
                    const shankFill = isFace ? '#cbd5e1' : '#64748b'; 
                    const bladeFill = isFace ? '#fbbf24' : '#d97706'; 
                    return (
                        <svg
                            key={i}
                            viewBox="0 0 100 160"
                            className="absolute top-0 left-0 w-full h-full"
                            style={{
                                transform: `translateZ(${z}px)`,
                                backfaceVisibility: 'hidden', 
                            }}
                        >
                            <path d={bladePath} fill={bladeFill} stroke={bladeFill} strokeWidth="0.5" />
                            {isFace && (
                                <path d={bladeDetail} fill="none" stroke="#b45309" strokeWidth="1" opacity="0.5" />
                            )}
                            <path d={shankPath} fill={shankFill} stroke={shankFill} strokeWidth="0.5" />
                            <path d={eyePath} fill="#0f172a" />
                        </svg>
                    );
                })}
            </div>
        </div>
    );
};

const Settings: React.FC<SettingsProps> = ({ 
    config, setConfig, onConnect, onDisconnect, isConnected, onNavigate,
    boatData, windSpeed, swellHeight, depth, seabedType, chainData,
    activeSubmenu, setActiveSubmenu
}) => {
    
    // Connection Workflow State
    const [isConnecting, setIsConnecting] = useState(false);
    const [connectionStatusText, setConnectionStatusText] = useState('Connecting...');
    const [showConnectSuccess, setShowConnectSuccess] = useState(false);
    const [redirectCountdown, setRedirectCountdown] = useState<number | null>(null);
    const [bleDebug, setBleDebug] = useState<{
        deviceName: string;
        status: string;
        subscribedUuids: string[];
        packets: string[];
    }>({
        deviceName: 'Unavailable',
        status: 'idle',
        subscribedUuids: [],
        packets: []
    });

    // Ref to hold the latest onNavigate function to avoid useEffect re-triggers
    const onNavigateRef = useRef(onNavigate);
    useEffect(() => {
        onNavigateRef.current = onNavigate;
    }, [onNavigate]);

    useEffect(() => {
        const handleBleDebug = (event: Event) => {
            const detail = (event as CustomEvent).detail || {};
            setBleDebug(prev => {
                if (detail.type === 'packet') {
                    const interval = detail.intervalMs !== null && detail.intervalMs !== undefined ? `${detail.intervalMs}ms` : 'first';
                    const hz = detail.estimatedHz ? `${detail.estimatedHz}Hz` : 'n/a';
                    const packetLine = `${detail.uuid || 'unknown'} | ${detail.byteLength ?? '?'} bytes | ${interval} | ${hz} | ${detail.hex || '-'}`;
                    return {
                        ...prev,
                        packets: [packetLine, ...prev.packets].slice(0, 10)
                    };
                }

                return {
                    ...prev,
                    deviceName: detail.deviceName || prev.deviceName,
                    status: detail.status || prev.status,
                    subscribedUuids: detail.subscribedUuids || prev.subscribedUuids
                };
            });
        };

        window.addEventListener('smartanchor-ble-debug', handleBleDebug);
        return () => window.removeEventListener('smartanchor-ble-debug', handleBleDebug);
    }, []);

    // ROBUST NAVIGATION EFFECT
    // Triggers navigation as soon as showConnectSuccess becomes true
    useEffect(() => {
        if (!showConnectSuccess) return;

        // Initialize Countdown
        setRedirectCountdown(2);

        // Step 1: Tick to 1s
        const t1 = setTimeout(() => {
            setRedirectCountdown(1);
        }, 1000);

        // Step 2: Tick to 0s and Navigate
        const t2 = setTimeout(() => {
            setRedirectCountdown(0);
            setShowConnectSuccess(false);
            onNavigateRef.current(AppTab.CALIBRATION);
        }, 2000);

        return () => {
            clearTimeout(t1);
            clearTimeout(t2);
        };
    }, [showConnectSuccess]); // Removed onNavigate from dependency to prevent reset loop

    const handleConnectClick = async () => {
        setIsConnecting(true);
        setConnectionStatusText('Initializing...');
        setBleDebug(prev => ({ ...prev, status: 'connecting', subscribedUuids: [], packets: [] }));
        
        // Safety Timeout (20s)
        const safetyTimeout = setTimeout(() => {
            setIsConnecting(false);
            setConnectionStatusText('Retry Connection');
            alert("Connection timed out. Sensor unresponsive.");
        }, 20000);

        try {
            // Visual feedback updated for robust sequence
            // SEQUENCE: Subscribing -> Enabling -> Period -> Done
            const step1 = setTimeout(() => setConnectionStatusText(config.sensorType === 'STM32_TILEBOX' ? 'Subscribing to notifications...' : 'Enabling Sensors...'), 500);
            const step2 = setTimeout(() => setConnectionStatusText(config.sensorType === 'STM32_TILEBOX' ? 'Subscribing to notifications...' : 'Setting 10Hz (100ms)...'), 2000);
            const step3 = setTimeout(() => setConnectionStatusText('Finalizing Setup...'), 3500);

            await onConnect();
            
            clearTimeout(step1);
            clearTimeout(step2);
            clearTimeout(step3);
            clearTimeout(safetyTimeout);
            
            setIsConnecting(false);
            // This state change triggers the useEffect above
            setConnectionStatusText('Connected');
            setShowConnectSuccess(true);

        } catch (e: any) {
            clearTimeout(safetyTimeout);
            setIsConnecting(false);
            setConnectionStatusText('Connect');
            
            // Check for User Cancellation (Chrome/Edge/Bluefy specific messages)
            // 'NotFoundError' is the standard error when user cancels the chooser
            const isUserCancelled = 
                e.name === 'NotFoundError' || 
                e.message?.includes('cancelled') || 
                e.message?.includes('User denied');

            if (isUserCancelled) {
                console.log("Connection cancelled by user.");
                // Do not alert, just return to idle state
                return;
            }
            
            // ROBUST ERROR HANDLING FOR "undefined" or weird objects
            let errorMsg = "Unknown Error";
            if (typeof e === 'string') {
                errorMsg = e;
            } else if (e instanceof Error) {
                errorMsg = e.message;
            } else if (e && e.toString) {
                errorMsg = e.toString();
            } else {
                 try {
                    errorMsg = JSON.stringify(e);
                 } catch {
                    errorMsg = "Unserializable Error";
                 }
            }
            
            console.warn("Connection attempt failed:", e);
            const diagnosticDetails = [
                `error.name: ${e?.originalErrorName || e?.name || 'Unknown'}`,
                `error.message: ${e?.originalErrorMessage || errorMsg}`,
                `step: ${e?.bluetoothStep || 'Unknown'}`,
                `device.name: ${e?.deviceName || 'Unavailable'}`,
                `device.id: ${e?.deviceId || 'Unavailable'}`,
                `service.uuid: ${e?.serviceUuid || 'Unavailable'}`,
                `characteristic.uuid: ${e?.characteristicUuid || 'Unavailable'}`,
                `available.characteristics:\n${e?.availableCharacteristics || 'Unavailable'}`,
                `raw.notifications:\n${e?.rawNotificationLogs || 'Unavailable'}`
            ].join('\n');

            alert(`Connection Failed\n\n${diagnosticDetails}`);
        }
    };

    const handleChange = (key: keyof AnchorConfig, value: number | string | null) => {
        setConfig(prev => ({ ...prev, [key]: value }));
    };
    const handleParamChange = (key: keyof RiskParameters, value: number) => {
        setConfig(prev => ({ ...prev, riskParameters: { ...prev.riskParameters, [key]: value } }));
    };
    const handleSeabedRiskChange = (type: string, value: number) => {
        setConfig(prev => ({...prev, seabedRisks: {...prev.seabedRisks, [type]: value}}));
    };
    const handleCoefficientChange = (key: keyof AnchorConfig['riskCoefficients'], value: number) => {
        setConfig(prev => ({...prev, riskCoefficients: {...prev.riskCoefficients, [key]: value}}));
    };
    const handleSensorTypeChange = (type: SensorType) => {
        if (isConnected) onDisconnect();
        setConfig(prev => ({ ...prev, sensorType: type }));
    };

    const SubmenuHeader = ({ title, onBack }: { title: string, onBack: () => void }) => (
        <div className="flex items-center gap-3 mb-2 flex-shrink-0">
            <button onClick={onBack} className="p-2 -ml-2 rounded-full hover:bg-ocean-800 text-ocean-400">
                <ArrowLeft className="w-6 h-6" />
            </button>
            <h2 className="text-xl font-bold text-white">{title}</h2>
        </div>
    );

    const CurrentStatusBox = ({ label, value, subtext }: { label: string, value: string, subtext?: string }) => (
        <div className="mb-4 bg-red-900/20 border-2 border-red-500 rounded-xl p-3 shadow-[0_0_15px_rgba(239,68,68,0.2)]">
            <p className="text-red-400 text-[10px] font-bold uppercase tracking-widest mb-1 flex items-center gap-1">
                <ShieldAlert className="w-3 h-3" /> CURRENT (YOU)
            </p>
            <div className="flex justify-between items-end">
                <div>
                    <p className="text-white font-bold text-lg">{label}</p>
                    {subtext && <p className="text-ocean-300 text-xs">{subtext}</p>}
                </div>
                <div className="text-right">
                    <p className="text-red-400 font-mono font-bold text-xl">{value}</p>
                </div>
            </div>
        </div>
    );

    const ParamInput = ({ label, paramKey, min, max, step }: { label: string, paramKey: keyof RiskParameters, min: number, max: number, step: number }) => (
        <div className="bg-ocean-800 p-3 rounded-lg border border-ocean-700/50 mb-3">
            <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-bold text-ocean-100">{label}</span>
                <span className="text-xs font-mono text-ocean-400">{config.riskParameters[paramKey]}</span>
            </div>
            <input 
                type="range" min={min} max={max} step={step} 
                value={config.riskParameters[paramKey]}
                onChange={(e) => handleParamChange(paramKey, Number(e.target.value))}
                className="w-full h-2 bg-ocean-900 rounded-lg appearance-none cursor-pointer accent-ocean-500" 
            />
        </div>
    );

    // --- SUBMENUS ---

    if (activeSubmenu === 'bluetooth') {
        return (
            <div className="flex flex-col h-full p-6 space-y-6 overflow-y-auto pb-32 bg-ocean-900 animate-in slide-in-from-right relative">
                {showConnectSuccess && (
                     <div className="absolute inset-0 z-50 bg-safe-900/95 flex flex-col items-center justify-center p-6 text-center animate-in fade-in">
                        <CheckCircle className="w-20 h-20 text-safe-500 mb-6" />
                        <h3 className="text-3xl font-bold text-white mb-2">Connected!</h3>
                        <p className="text-safe-200 text-lg">Redirecting to Calibration...</p>
                        <div className="mt-4 text-4xl font-bold text-white">{redirectCountdown}</div>
                     </div>
                )}
                
                <SubmenuHeader title="Connectivity" onBack={() => setActiveSubmenu('none')} />
                <div className="bg-ocean-800 p-4 rounded-xl border border-ocean-700 space-y-3 flex-shrink-0">
                    <label className="text-xs font-bold text-ocean-400 uppercase tracking-wider">Device Driver</label>
                    <div className="grid grid-cols-1 gap-2">
                        {['SIMULATOR', 'STM32_TILEBOX'].map((type) => (
                            <button key={type} onClick={() => handleSensorTypeChange(type as SensorType)} className={`p-3 rounded-lg border text-left flex items-center gap-3 transition-all ${config.sensorType === type ? 'bg-ocean-600 border-ocean-400 text-white' : 'bg-ocean-900 border-ocean-700 text-gray-400'}`}>
                                <Box className="w-5 h-5" />
                                <div>
                                    <div className="font-bold text-sm">{type === 'STM32_TILEBOX' ? 'STM32 SensorTile / SensorBoxPro' : 'Simulator'}</div>
                                </div>
                                {config.sensorType === type && <Check className="w-4 h-4 ml-auto" />}
                            </button>
                        ))}
                    </div>
                </div>
                <div className={`p-6 rounded-xl border flex flex-col items-center text-center space-y-4 flex-shrink-0 ${isConnected ? 'bg-safe-900/20 border-safe-500' : 'bg-ocean-800 border-ocean-700'}`}>
                    {isConnecting ? (
                         <div className="flex flex-col items-center gap-2">
                             <Loader2 className="w-12 h-12 text-ocean-500 animate-spin" />
                             <p className="text-xs text-ocean-300 animate-pulse">{connectionStatusText}</p>
                         </div>
                    ) : (
                         <Bluetooth className={`w-12 h-12 ${isConnected ? 'text-safe-500' : 'text-ocean-400'}`} />
                    )}
                    
                    <button 
                        onClick={isConnected ? onDisconnect : handleConnectClick} 
                        disabled={isConnecting}
                        className={`w-full py-3 rounded-lg font-bold flex items-center justify-center gap-2 transition-all active:scale-95 ${
                            isConnected ? 'bg-ocean-800 text-red-400 border border-red-500/50' : 'bg-ocean-500 text-white hover:bg-ocean-400'
                        }`}
                    >
                        <Power className="w-4 h-4" /> 
                        {isConnecting ? connectionStatusText : (isConnected ? 'Disconnect' : 'Connect')}
                    </button>
                </div>
                <div className="bg-ocean-800 p-3 rounded-xl border border-ocean-700 text-left text-xs font-mono text-ocean-200 space-y-2 flex-shrink-0">
                    <div className="flex justify-between gap-2">
                        <span className="text-ocean-400">device.name</span>
                        <span className="text-white truncate">{bleDebug.deviceName}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                        <span className="text-ocean-400">status</span>
                        <span className={bleDebug.status === 'failed' ? 'text-alert-500' : bleDebug.status === 'connected' ? 'text-safe-500' : 'text-ocean-300'}>{bleDebug.status}</span>
                    </div>
                    <div>
                        <div className="text-ocean-400 mb-1">Subscribed characteristics:</div>
                        <div className="break-all text-white">{bleDebug.subscribedUuids.length > 0 ? bleDebug.subscribedUuids.join(', ') : '-'}</div>
                    </div>
                    <div>
                        <div className="text-ocean-400 mb-1">Last packets:</div>
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                            {bleDebug.packets.length > 0 ? bleDebug.packets.map((packet, index) => (
                                <div key={`${packet}-${index}`} className="break-all text-ocean-100">{packet}</div>
                            )) : <div className="text-ocean-500">-</div>}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (activeSubmenu === 'thresholds') {
        return (
            <div className="flex flex-col h-full p-6 space-y-6 overflow-y-auto pb-32 bg-ocean-900 animate-in slide-in-from-right">
                <SubmenuHeader title="Sensor Thresholds" onBack={() => setActiveSubmenu('none')} />
                <div 
                    className="bg-ocean-800 rounded-xl border border-ocean-700 relative flex items-center justify-center overflow-hidden perspective-800 group flex-shrink-0"
                    style={{ minHeight: '250px', height: '250px' }}
                >
                    <div className="absolute inset-0 bg-gradient-to-b from-ocean-800 to-ocean-900"></div>
                    <div className="absolute top-1/2 left-[-50%] w-[200%] h-[200%] bg-[linear-gradient(rgba(56,189,248,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(56,189,248,0.1)_1px,transparent_1px)] bg-[size:20px_20px] [transform:rotateX(70deg)] origin-top"></div>
                    <div 
                        className="relative w-60 h-60 flex items-center justify-center transition-transform duration-300 ease-out preserve-3d"
                        style={{ 
                            transformStyle: 'preserve-3d',
                            transform: `rotateX(${config.maxPitch}deg) rotateZ(${config.maxRoll}deg) rotateY(${config.maxYaw}deg)` 
                        }}
                    >
                        <div className="w-full h-full transform drop-shadow-[0_10px_20px_rgba(0,0,0,0.5)]" style={{ transformStyle: 'preserve-3d' }}>
                             <Anchor3D />
                        </div>
                        <div className="absolute top-0 bottom-0 left-1/2 w-px bg-red-500/30"></div>
                        <div className="absolute left-0 right-0 top-1/2 h-px bg-blue-500/30"></div>
                    </div>
                    <div className="absolute bottom-2 left-3 text-[10px] text-ocean-400 font-mono">
                        P: {config.maxPitch}°  R: {config.maxRoll}°  Y: {config.maxYaw}°
                    </div>
                    <div className="absolute top-2 right-3 flex items-center gap-1 text-[10px] text-ocean-400 bg-ocean-900/50 px-2 py-1 rounded-full">
                        <Rotate3D className="w-3 h-3" /> Live Preview
                    </div>
                </div>

                <div className="bg-ocean-800 p-5 rounded-xl border border-ocean-700 space-y-6 flex-shrink-0">
                    <div>
                         <div className="flex justify-between mb-2">
                            <span className="font-bold text-white flex items-center gap-2"><MoveVertical className="w-4 h-4 text-red-400"/> Max Pitch</span>
                            <span className="font-mono text-ocean-300">{config.maxPitch}°</span>
                         </div>
                         <p className="text-xs text-ocean-400 mb-2">Maximum forward/backward tilt before alarm.</p>
                         <input type="range" min="0" max="90" step="1" value={config.maxPitch} onChange={(e) => handleChange('maxPitch', Number(e.target.value))} className="w-full h-2 bg-ocean-900 rounded-lg appearance-none cursor-pointer accent-red-500" />
                    </div>
                    <div>
                         <div className="flex justify-between mb-2">
                            <span className="font-bold text-white flex items-center gap-2"><MoveHorizontal className="w-4 h-4 text-blue-400"/> Max Roll</span>
                            <span className="font-mono text-ocean-300">{config.maxRoll}°</span>
                         </div>
                         <p className="text-xs text-ocean-400 mb-2">Maximum side-to-side tilt (rolling) before alarm.</p>
                         <input type="range" min="0" max="90" step="1" value={config.maxRoll} onChange={(e) => handleChange('maxRoll', Number(e.target.value))} className="w-full h-2 bg-ocean-900 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                    </div>
                    <div>
                         <div className="flex justify-between mb-2">
                            <span className="font-bold text-white flex items-center gap-2"><RefreshCw className="w-4 h-4 text-green-400"/> Max Yaw</span>
                            <span className="font-mono text-ocean-300">{config.maxYaw}°</span>
                         </div>
                         <p className="text-xs text-ocean-400 mb-2">Maximum rotation (swinging) at anchor.</p>
                         <input type="range" min="0" max="180" step="5" value={config.maxYaw} onChange={(e) => handleChange('maxYaw', Number(e.target.value))} className="w-full h-2 bg-ocean-900 rounded-lg appearance-none cursor-pointer accent-green-500" />
                    </div>
                </div>
            </div>
        );
    }

    if (activeSubmenu === 'risk_factors') {
        return (
            <div className="flex flex-col h-full p-6 space-y-3 overflow-y-auto pb-32 bg-ocean-900 animate-in slide-in-from-right">
                <SubmenuHeader title="Risk Factors" onBack={() => setActiveSubmenu('none')} />
                
                <p className="text-xs text-ocean-400 mb-4 px-1">Configure how environmental factors contribute to the global risk score (1-10).</p>

                <button onClick={() => setActiveSubmenu('rf_hardware')} className="w-full bg-ocean-800 p-4 rounded-xl border border-ocean-700 flex items-center justify-between group hover:bg-ocean-750">
                    <div className="flex items-center gap-3"><Weight className="w-5 h-5 text-ocean-400" /><span className="font-bold text-white">Hardware (Boat/Anchor)</span></div><ChevronRight className="w-4 h-4 text-ocean-600" />
                </button>
                <button onClick={() => setActiveSubmenu('rf_wind')} className="w-full bg-ocean-800 p-4 rounded-xl border border-ocean-700 flex items-center justify-between group hover:bg-ocean-750">
                    <div className="flex items-center gap-3"><Wind className="w-5 h-5 text-ocean-400" /><span className="font-bold text-white">Wind Factor</span></div><ChevronRight className="w-4 h-4 text-ocean-600" />
                </button>
                <button onClick={() => setActiveSubmenu('rf_depth')} className="w-full bg-ocean-800 p-4 rounded-xl border border-ocean-700 flex items-center justify-between group hover:bg-ocean-750">
                    <div className="flex items-center gap-3"><ArrowDown className="w-5 h-5 text-ocean-400" /><span className="font-bold text-white">Depth Factor</span></div><ChevronRight className="w-4 h-4 text-ocean-600" />
                </button>
                <button onClick={() => setActiveSubmenu('rf_swell')} className="w-full bg-ocean-800 p-4 rounded-xl border border-ocean-700 flex items-center justify-between group hover:bg-ocean-750">
                    <div className="flex items-center gap-3"><Waves className="w-5 h-5 text-ocean-400" /><span className="font-bold text-white">Swell Factor</span></div><ChevronRight className="w-4 h-4 text-ocean-600" />
                </button>
                <button onClick={() => setActiveSubmenu('rf_seabed')} className="w-full bg-ocean-800 p-4 rounded-xl border border-ocean-700 flex items-center justify-between group hover:bg-ocean-750">
                    <div className="flex items-center gap-3"><Layers className="w-5 h-5 text-ocean-400" /><span className="font-bold text-white">Seabed Multiplier</span></div><ChevronRight className="w-4 h-4 text-ocean-600" />
                </button>
                <button onClick={() => setActiveSubmenu('rf_scope')} className="w-full bg-ocean-800 p-4 rounded-xl border border-ocean-700 flex items-center justify-between group hover:bg-ocean-750">
                    <div className="flex items-center gap-3"><Link className="w-5 h-5 text-ocean-400" /><span className="font-bold text-white">Scope Penalty</span></div><ChevronRight className="w-4 h-4 text-ocean-600" />
                </button>
            </div>
        );
    }

    if (activeSubmenu === 'rf_hardware') {
        const displacementTonnes = boatData.displacement / 1000;
        const tacklePower = boatData.anchorWeight + ((boatData.chainWeight || 2) * 10);
        const ratio = displacementTonnes > 0 ? tacklePower / displacementTonnes : 0;
        
        return (
            <div className="flex flex-col h-full p-6 space-y-4 overflow-y-auto pb-32 bg-ocean-900 animate-in slide-in-from-right">
                <SubmenuHeader title="Hardware Factor" onBack={() => setActiveSubmenu('risk_factors')} />
                
                <CurrentStatusBox label="Ratio" value={ratio.toFixed(2)} subtext="(Anchor + 10m Chain) / Displacement" />

                <ParamInput label="Weak Threshold" paramKey="hw_weak_threshold" min={1} max={6} step={0.1} />
                <ParamInput label="Marginal Threshold" paramKey="hw_marginal_threshold" min={1} max={8} step={0.1} />
                <ParamInput label="Standard Threshold" paramKey="hw_standard_threshold" min={2} max={10} step={0.1} />
                
                <div className="p-3 bg-ocean-800 rounded border border-ocean-700/50 text-xs text-ocean-300 mt-2">
                    Defines risk multipliers based on ground tackle size vs boat weight. Lower ratio = Higher risk.
                </div>
            </div>
        );
    }

    if (activeSubmenu === 'rf_wind') {
        return (
            <div className="flex flex-col h-full p-6 space-y-4 overflow-y-auto pb-32 bg-ocean-900 animate-in slide-in-from-right">
                <SubmenuHeader title="Wind Factor" onBack={() => setActiveSubmenu('risk_factors')} />
                
                <CurrentStatusBox label="Wind" value={`${windSpeed} kts`} subtext={`Factor: +${config.calculatedWindFactor}`} />

                <ParamInput label="Safe Limit (kts)" paramKey="wind_safe_limit" min={0} max={20} step={1} />
                <ParamInput label="Alert Limit (kts)" paramKey="wind_alert_limit" min={10} max={40} step={1} />
                <ParamInput label="Slope (Gentle)" paramKey="wind_slope_gentle" min={0.01} max={0.1} step={0.01} />
                <ParamInput label="Slope (Steep)" paramKey="wind_slope_steep" min={0.01} max={0.2} step={0.01} />
            </div>
        );
    }

    if (activeSubmenu === 'rf_depth') {
        return (
            <div className="flex flex-col h-full p-6 space-y-4 overflow-y-auto pb-32 bg-ocean-900 animate-in slide-in-from-right">
                <SubmenuHeader title="Depth Factor" onBack={() => setActiveSubmenu('risk_factors')} />
                
                <CurrentStatusBox label="Depth" value={`${depth} m`} subtext={`Factor: +${config.calculatedDepthFactor}`} />

                <ParamInput label="Shallow Limit (m)" paramKey="depth_shallow_limit" min={1} max={5} step={0.5} />
                <ParamInput label="Ideal Limit (m)" paramKey="depth_ideal_limit" min={5} max={15} step={0.5} />
                <ParamInput label="Deep Limit (m)" paramKey="depth_deep_limit" min={10} max={30} step={1} />
                
                <ParamInput label="Shallow Penalty" paramKey="depth_shallow_penalty" min={0} max={1} step={0.1} />
                <ParamInput label="Mid Slope" paramKey="depth_slope_mid" min={0.01} max={0.1} step={0.01} />
                <ParamInput label="Deep Slope" paramKey="depth_slope_deep" min={0.01} max={0.2} step={0.01} />
            </div>
        );
    }

    if (activeSubmenu === 'rf_seabed') {
        return (
            <div className="flex flex-col h-full p-6 space-y-4 overflow-y-auto pb-32 bg-ocean-900 animate-in slide-in-from-right">
                <SubmenuHeader title="Seabed Risks" onBack={() => setActiveSubmenu('risk_factors')} />
                
                <CurrentStatusBox label="Seabed" value={seabedType} subtext={`Multiplier: x${config.calculatedSeabedFactor.toFixed(2)}`} />

                <ParamInput label="Step Multiplier" paramKey="seabed_step_multiplier" min={0.1} max={1.0} step={0.05} />
                
                <p className="text-xs font-bold text-white mt-4 mb-2">RISK LEVELS (1=Best, 5=Worst)</p>
                {Object.keys(config.seabedRisks).map(type => (
                    <div key={type} className="bg-ocean-800 p-3 rounded-lg border border-ocean-700/50 mb-2">
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-sm font-bold text-ocean-100">{type}</span>
                            <span className="text-xs font-mono text-ocean-400">{config.seabedRisks[type]}</span>
                        </div>
                        <input 
                            type="range" min="1" max="5" step="1" 
                            value={config.seabedRisks[type]}
                            onChange={(e) => handleSeabedRiskChange(type, Number(e.target.value))}
                            className="w-full h-2 bg-ocean-900 rounded-lg appearance-none cursor-pointer accent-ocean-500" 
                        />
                    </div>
                ))}
            </div>
        );
    }

    if (activeSubmenu === 'rf_scope') {
        return (
            <div className="flex flex-col h-full p-6 space-y-4 overflow-y-auto pb-32 bg-ocean-900 animate-in slide-in-from-right">
                <SubmenuHeader title="Scope Penalties" onBack={() => setActiveSubmenu('risk_factors')} />
                
                <p className="text-xs text-ocean-400 mb-2">Multipliers applied when chain is too short.</p>

                <div className="space-y-3">
                    <div className="bg-ocean-800 p-3 rounded-lg border border-ocean-700/50">
                        <div className="flex justify-between mb-1"><span className="text-sm font-bold text-white">Bonus (Safe Scope)</span><span className="text-xs font-mono text-ocean-300">x{config.riskCoefficients.scopeBonus}</span></div>
                        <input type="range" min="0.5" max="1.0" step="0.05" value={config.riskCoefficients.scopeBonus} onChange={(e) => handleCoefficientChange('scopeBonus', Number(e.target.value))} className="w-full h-2 bg-ocean-900 rounded-lg appearance-none cursor-pointer accent-safe-500" />
                    </div>
                    <div className="bg-ocean-800 p-3 rounded-lg border border-ocean-700/50">
                        <div className="flex justify-between mb-1"><span className="text-sm font-bold text-white">Light Penalty</span><span className="text-xs font-mono text-ocean-300">x{config.riskCoefficients.scopePenaltyLight}</span></div>
                        <input type="range" min="1.0" max="2.0" step="0.1" value={config.riskCoefficients.scopePenaltyLight} onChange={(e) => handleCoefficientChange('scopePenaltyLight', Number(e.target.value))} className="w-full h-2 bg-ocean-900 rounded-lg appearance-none cursor-pointer accent-yellow-500" />
                    </div>
                    <div className="bg-ocean-800 p-3 rounded-lg border border-ocean-700/50">
                        <div className="flex justify-between mb-1"><span className="text-sm font-bold text-white">Medium Penalty</span><span className="text-xs font-mono text-ocean-300">x{config.riskCoefficients.scopePenaltyMedium}</span></div>
                        <input type="range" min="1.2" max="3.0" step="0.1" value={config.riskCoefficients.scopePenaltyMedium} onChange={(e) => handleCoefficientChange('scopePenaltyMedium', Number(e.target.value))} className="w-full h-2 bg-ocean-900 rounded-lg appearance-none cursor-pointer accent-orange-500" />
                    </div>
                    <div className="bg-ocean-800 p-3 rounded-lg border border-ocean-700/50">
                        <div className="flex justify-between mb-1"><span className="text-sm font-bold text-white">Heavy Penalty</span><span className="text-xs font-mono text-ocean-300">x{config.riskCoefficients.scopePenaltyHeavy}</span></div>
                        <input type="range" min="1.5" max="5.0" step="0.1" value={config.riskCoefficients.scopePenaltyHeavy} onChange={(e) => handleCoefficientChange('scopePenaltyHeavy', Number(e.target.value))} className="w-full h-2 bg-ocean-900 rounded-lg appearance-none cursor-pointer accent-alert-500" />
                    </div>
                </div>
            </div>
        );
    }

    if (activeSubmenu === 'rf_swell') {
        return (
            <div className="flex flex-col h-full p-6 space-y-4 overflow-y-auto pb-32 bg-ocean-900 animate-in slide-in-from-right">
                <SubmenuHeader title="Swell Factor" onBack={() => setActiveSubmenu('risk_factors')} />
                
                <CurrentStatusBox label="Swell" value={`${swellHeight} m`} subtext={`Factor: +${config.calculatedSwellFactor}`} />

                <ParamInput label="Safe Limit (m)" paramKey="swell_safe_limit" min={0} max={2.0} step={0.1} />
                <ParamInput label="Slope" paramKey="swell_slope" min={0.05} max={0.5} step={0.05} />
            </div>
        );
    }

    if (activeSubmenu === 'current_risk') {
        // --- LIVE CALCULATION LOGIC FOR DASHBOARD ---
        
        // 1. Hardware Factor Calculation (Local Re-calc)
        let hwFactor = 1.0;
        const displacementTonnes = boatData.displacement / 1000;
        if (displacementTonnes > 0 && boatData.anchorWeight > 0) {
            const chainW = boatData.chainWeight || 1.8; 
            const tacklePower = boatData.anchorWeight + (chainW * 10);
            const ratio = tacklePower / displacementTonnes;
            const p = config.riskParameters;
            if (ratio < p.hw_weak_threshold) hwFactor = 1.5; 
            else if (ratio < p.hw_marginal_threshold) { 
                const range = p.hw_marginal_threshold - p.hw_weak_threshold;
                const pos = ratio - p.hw_weak_threshold;
                hwFactor = 1.5 - ((pos / range) * 0.5); 
            } 
            else if (ratio <= p.hw_standard_threshold) hwFactor = 1.0; 
            else hwFactor = 0.8;
        }

        // 2. Scope Factor Calculation (Local Re-calc)
        let scopeFactor = 1.0;
        if (chainData.requiredLength > 0 && chainData.actualLength > 0) {
            const shortage = chainData.requiredLength - chainData.actualLength;
            const c = config.riskCoefficients;
            if (shortage < 0) scopeFactor = c.scopeBonus;
            else if (shortage === 0) scopeFactor = 1.0;
            else if (shortage <= 3) scopeFactor = c.scopePenaltyLight;
            else if (shortage <= 10) scopeFactor = c.scopePenaltyMedium;
            else scopeFactor = c.scopePenaltyHeavy;
        }

        // 3. Total Environmental Risk Calculation
        const baseEnvSum = config.calculatedWindFactor + config.calculatedDepthFactor + config.calculatedSwellFactor;
        const totalEnvRisk = baseEnvSum * config.calculatedSeabedFactor * scopeFactor * hwFactor;
        
        // Convert to 1-10 Scale Contribution (Approximate)
        const scoreContribution = Math.min(10, Math.ceil(totalEnvRisk * 10));
        
        let riskColor = 'text-safe-500';
        let riskBg = 'bg-safe-900/30 border-safe-500';
        let riskLabel = 'LOW RISK';
        
        if (scoreContribution >= 8) {
            riskColor = 'text-alert-500';
            riskBg = 'bg-alert-900/30 border-alert-500';
            riskLabel = 'CRITICAL';
        } else if (scoreContribution >= 5) {
            riskColor = 'text-orange-500';
            riskBg = 'bg-orange-900/30 border-orange-500';
            riskLabel = 'ELEVATED';
        }

        return (
            <div className="flex flex-col h-full p-6 space-y-4 overflow-y-auto pb-24 bg-ocean-900 animate-in slide-in-from-right">
                <SubmenuHeader title="Risk Calculation" onBack={() => setActiveSubmenu('none')} />
                
                {/* TOTAL RISK SCORE CARD (COMPACT VERSION) */}
                <div className={`p-3 rounded-xl border-2 flex items-center justify-between ${riskBg} shadow-lg`}>
                    <div>
                        <p className={`text-[10px] font-bold uppercase tracking-wider mb-1 ${riskColor}`}>Risk Level</p>
                        <h2 className={`text-2xl font-black ${riskColor}`}>{scoreContribution} <span className="text-lg opacity-60">/ 10</span></h2>
                    </div>
                    <div className={`px-3 py-1.5 rounded-lg font-bold text-xs uppercase tracking-widest ${riskColor} bg-black/20`}>
                        {riskLabel}
                    </div>
                </div>

                <div className="bg-ocean-800/50 p-4 rounded-xl border border-ocean-700 mb-2">
                    <p className="text-xs text-ocean-300 mb-2">This dashboard shows how the <strong>Environmental Risk Score</strong> is computed in real-time based on your current conditions and settings.</p>
                </div>

                {/* THE EQUATION */}
                <div className="bg-ocean-800 rounded-xl border border-ocean-700 p-4 overflow-x-auto whitespace-nowrap scrollbar-hide flex-shrink-0">
                    <p className="text-[10px] font-bold text-ocean-400 uppercase tracking-wider mb-2">The Equation</p>
                    <div className="flex items-center gap-2 font-mono text-sm text-white">
                        <span className="text-ocean-300">(</span>
                        <span className="text-blue-400">Wind</span>
                        <span>+</span>
                        <span className="text-cyan-400">Depth</span>
                        <span>+</span>
                        <span className="text-indigo-400">Swell</span>
                        <span className="text-ocean-300">)</span>
                        <span>×</span>
                        <span className="text-yellow-400">Seabed</span>
                        <span>×</span>
                        <span className="text-orange-400">Scope</span>
                        <span>×</span>
                        <span className="text-purple-400">Boat</span>
                    </div>
                    {/* Numerical Representation */}
                    <div className="flex items-center gap-2 font-mono text-lg font-bold text-white mt-2 flex-wrap">
                        <span className="text-ocean-300">(</span>
                        <span className="text-blue-400">{config.calculatedWindFactor.toFixed(2)}</span>
                        <span>+</span>
                        <span className="text-cyan-400">{config.calculatedDepthFactor.toFixed(2)}</span>
                        <span>+</span>
                        <span className="text-indigo-400">{config.calculatedSwellFactor.toFixed(2)}</span>
                        <span className="text-ocean-300">)</span>
                        <span>×</span>
                        <span className="text-yellow-400">{config.calculatedSeabedFactor.toFixed(2)}</span>
                        <span>×</span>
                        <span className="text-orange-400">{scopeFactor.toFixed(2)}</span>
                        <span>×</span>
                        <span className="text-purple-400">{hwFactor.toFixed(2)}</span>
                        <span className="text-gray-500 mx-2">=</span>
                        <span className="text-red-400">{totalEnvRisk.toFixed(2)}</span>
                    </div>
                </div>

                <div className="space-y-2">
                    <p className="text-[10px] font-bold text-ocean-400 uppercase tracking-wider mt-2">Live Factors</p>
                    <div className="grid grid-cols-3 gap-2">
                        <div className="bg-ocean-800 p-2 rounded border border-ocean-700 text-center">
                            <span className="text-[9px] text-blue-400 font-bold block mb-1">WIND ({windSpeed}kts)</span>
                            <span className="font-mono text-white text-lg">+{config.calculatedWindFactor.toFixed(2)}</span>
                        </div>
                        <div className="bg-ocean-800 p-2 rounded border border-ocean-700 text-center">
                            <span className="text-[9px] text-cyan-400 font-bold block mb-1">DEPTH ({depth}m)</span>
                            <span className="font-mono text-white text-lg">+{config.calculatedDepthFactor.toFixed(2)}</span>
                        </div>
                        <div className="bg-ocean-800 p-2 rounded border border-ocean-700 text-center">
                            <span className="text-[9px] text-indigo-400 font-bold block mb-1">SWELL ({swellHeight}m)</span>
                            <span className="font-mono text-white text-lg">+{config.calculatedSwellFactor.toFixed(2)}</span>
                        </div>
                    </div>
                    
                    <div className="bg-ocean-800 p-3 rounded-xl border border-ocean-700 flex justify-between items-center">
                        <div>
                            <span className="text-[9px] text-yellow-400 font-bold block mb-1">SEABED ({seabedType.toUpperCase()})</span>
                            <span className="text-xs text-ocean-400">Nature of ground</span>
                        </div>
                        <span className="font-mono text-yellow-400 text-xl font-bold">x{config.calculatedSeabedFactor.toFixed(2)}</span>
                    </div>

                    <div className="bg-ocean-800 p-3 rounded-xl border border-ocean-700 flex justify-between items-center">
                        <div>
                            <span className="text-[9px] text-orange-400 font-bold block mb-1">CHAIN FACTOR</span>
                            <span className="text-xs text-ocean-400">Deployed vs Required</span>
                        </div>
                        <span className="font-mono text-white text-xl font-bold">x{scopeFactor.toFixed(2)}</span>
                    </div>

                    <div className="bg-ocean-800 p-3 rounded-xl border border-ocean-700 flex justify-between items-center">
                        <div>
                            <span className="text-[9px] text-purple-400 font-bold block mb-1">BOAT FACTOR</span>
                            <span className="text-xs text-ocean-400">Equipment Ratio: {(chainData.actualLength > 0 ? (boatData.anchorWeight/ (boatData.displacement/1000)) : 0).toFixed(2)}</span>
                        </div>
                        <span className="font-mono text-white text-xl font-bold">x{hwFactor.toFixed(2)}</span>
                    </div>
                </div>
            </div>
        );
    }

 
    return (
        <div className="flex flex-col h-full p-6 space-y-6 overflow-y-auto pb-32">
            <div className="flex items-center justify-between mb-2 flex-shrink-0">
                <h2 className="text-2xl font-bold text-white flex items-center gap-2"><SettingsIcon className="w-6 h-6 text-ocean-500" /> Bluetooth & Sensors</h2>
            </div>
            <div className="space-y-3 flex-shrink-0">
                <button onClick={() => setActiveSubmenu('bluetooth')} className="w-full bg-ocean-800 p-5 rounded-xl border border-ocean-700 flex items-center justify-between group hover:bg-ocean-750 transition-colors">
                    <div className="flex items-center gap-4"><div className={`p-3 rounded-lg transition-colors ${isConnected ? 'bg-safe-900/50' : 'bg-ocean-700 group-hover:bg-ocean-600'}`}><Bluetooth className={`w-6 h-6 ${isConnected ? 'text-safe-500' : 'text-ocean-400'}`} /></div><div className="text-left"><h3 className="font-bold text-white text-lg">Connectivity</h3><p className={`text-sm ${isConnected ? 'text-safe-500' : 'text-ocean-400'}`}>{isConnected ? `Connected: ${config.bluetoothDeviceName}` : "Setup Connection"}</p></div></div><ChevronRight className="w-5 h-5 text-ocean-600" />
                </button>
                <button onClick={() => setActiveSubmenu('thresholds')} className="w-full bg-ocean-800 p-5 rounded-xl border border-ocean-700 flex items-center justify-between group hover:bg-ocean-750 transition-colors">
                    <div className="flex items-center gap-4"><div className="p-3 bg-ocean-700 rounded-lg group-hover:bg-ocean-600 transition-colors"><Sliders className="w-6 h-6 text-ocean-400" /></div><div className="text-left"><h3 className="font-bold text-white text-lg">Sensor Thresholds</h3><p className="text-sm text-ocean-400">Pitch: {config.maxPitch}°, Roll: {config.maxRoll}°</p></div></div><ChevronRight className="w-5 h-5 text-ocean-600" />
                </button>
                <button onClick={() => setActiveSubmenu('risk_factors')} className="w-full bg-ocean-800 p-5 rounded-xl border border-ocean-700 flex items-center justify-between group hover:bg-ocean-750 transition-colors">
                    <div className="flex items-center gap-4"><div className="p-3 bg-ocean-700 rounded-lg group-hover:bg-ocean-600 transition-colors"><ShieldAlert className="w-6 h-6 text-ocean-400" /></div><div className="text-left"><h3 className="font-bold text-white text-lg">Risk Factors</h3><p className="text-sm text-ocean-400">Configure Algorithm</p></div></div><ChevronRight className="w-5 h-5 text-ocean-600" />
                </button>
                <button onClick={() => setActiveSubmenu('current_risk')} className="w-full bg-ocean-800 p-5 rounded-xl border border-ocean-700 flex items-center justify-between group hover:bg-ocean-750 transition-colors">
                    <div className="flex items-center gap-4"><div className="p-3 bg-ocean-700 rounded-lg group-hover:bg-ocean-600 transition-colors"><Calculator className="w-6 h-6 text-ocean-400" /></div><div className="text-left"><h3 className="font-bold text-white text-lg">Current Risk Calcul</h3><p className="text-sm text-ocean-400">Live Equation Dashboard</p></div></div><ChevronRight className="w-5 h-5 text-ocean-600" />
                </button>
            </div>
        </div>
    );
};
 
export default Settings;
