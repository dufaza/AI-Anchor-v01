
import React, { useState, useEffect } from 'react';
import { Info, Wind, Anchor, AlertTriangle, CheckCircle, ArrowDown, Layers, ArrowUpFromLine, Link, Waves } from 'lucide-react';
import { ChainData } from '../types';

interface ScopeCalculatorProps {
    seabedType: string;
    setSeabedType: (type: string) => void;
    chainData: ChainData;
    setChainData: (data: ChainData) => void;
    windSpeed: number;
    setWindSpeed: (speed: number) => void;
    swellHeight: number;
    setSwellHeight: (height: number) => void;
    depth: number;
    setDepth: (depth: number) => void;
    defaultFreeboard: number; // This is the Boat bow height
    maxChainLength: number; // New: Limit from Boat Settings
    seabedRiskFactor?: number; // New: Multiplier from Global Settings
}

const ScopeCalculator: React.FC<ScopeCalculatorProps> = ({ 
    seabedType, 
    setSeabedType, 
    chainData, 
    setChainData,
    windSpeed,
    setWindSpeed,
    swellHeight,
    setSwellHeight,
    depth, 
    setDepth,
    defaultFreeboard,
    maxChainLength,
    seabedRiskFactor = 1.0
}) => {
    const [unit, setUnit] = useState<'m' | 'ft'>('m');
    
    // User input for verification 
    // Initialize from parent state to persist value, or default to 35
    const [actualLength, setActualLength] = useState<number>(chainData.actualLength || 35); 
    const [isMaxedOut, setIsMaxedOut] = useState(false);

    // Calculated values
    const [recommendedScope, setRecommendedScope] = useState<number>(5);
    const [requiredLength, setRequiredLength] = useState<number>(0);
    const [shortage, setShortage] = useState<number>(0);
    const [ratioBreakdown, setRatioBreakdown] = useState({ base: 0, swell: 0, seabed: 1.0 });

    useEffect(() => {
        // Use defaultFreeboard directly from boat settings
        const totalHeight = Number(depth) + Number(defaultFreeboard);
        
        // 1. Determine Base Ratio automatically based on Wind Speed
        // < 10: Ratio 3
        // 10 - 15: Ratio 4 (Gentle Breeze)
        // 15 - 25: Ratio 5 (Standard / Moderate)
        // 25 - 35: Ratio 6 (Fresh / Gale)
        // > 35: Ratio 7 (Storm / Max practical)
        let baseRatio = 3;
        if (windSpeed >= 35) baseRatio = 7;
        else if (windSpeed >= 25) baseRatio = 6;
        else if (windSpeed >= 15) baseRatio = 5;
        else if (windSpeed >= 10) baseRatio = 4;
        else baseRatio = 3;
        
        // 2. Determine Swell Adder
        // 0 - 0.5m: +0
        // 0.6 - 1.4m: +1
        // 1.5 - 2.4m: +2
        // 2.5 - 3.4m: +3
        // >= 3.5m: +4
        let swellAdder = 0;
        if (swellHeight >= 3.5) swellAdder = 4;
        else if (swellHeight >= 2.5) swellAdder = 3;
        else if (swellHeight >= 1.5) swellAdder = 2;
        else if (swellHeight >= 0.6) swellAdder = 1;

        // 3. Apply Seabed Factor (Multiplier)
        // Calculate effective ratio
        const combinedBase = baseRatio + swellAdder;
        const totalRatio = combinedBase * seabedRiskFactor;
        
        setRecommendedScope(parseFloat(totalRatio.toFixed(1)));
        setRatioBreakdown({ base: baseRatio, swell: swellAdder, seabed: seabedRiskFactor });

        // 4. Calculate Required Length based on that ratio
        const req = totalHeight * totalRatio;
        setRequiredLength(req);

        // 5. Calculate Validation (Shortage/Excess)
        if (actualLength > 0) {
            setShortage(req - actualLength);
        } else {
            setShortage(0);
        }

        // 6. Update Parent State for Smart Anchor Risk Analysis
        setChainData({
            requiredLength: req,
            actualLength: actualLength
        });
        
        // Check if current value exceeds limit (in case boat settings changed)
        if (maxChainLength > 0 && actualLength > maxChainLength) {
             setActualLength(maxChainLength);
             setIsMaxedOut(true);
        } else {
             setIsMaxedOut(false);
        }

    }, [depth, defaultFreeboard, windSpeed, swellHeight, actualLength, setChainData, maxChainLength, seabedRiskFactor]);

    const handleDeployedChange = (val: number) => {
        if (maxChainLength > 0 && val > maxChainLength) {
            setActualLength(maxChainLength);
            setIsMaxedOut(true);
        } else {
            setActualLength(val);
            setIsMaxedOut(false);
        }
    };

    const labelStyle = "block text-xs font-bold text-ocean-400 uppercase tracking-wider mb-1";
    const inputStyle = "w-full bg-ocean-800 border border-ocean-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-ocean-500 focus:outline-none transition-all font-mono text-sm";

    // Helper for seabed advice
    const getSeabedTip = (type: string) => {
        switch (type) {
            case 'Sand': return 'Excellent holding. Anchor sets quickly.';
            case 'Vase': return 'Mud requires deep setting. Good once dug in.';
            case 'Herbarium': return 'Poor holding (Seagrass). Use higher scope.';
            case 'Rock': return 'Very poor holding. Risk of fouling.';
            case 'Other': return 'Check pilot book for local conditions.';
            default: return '';
        }
    };
 
    return (
        // Changed: Removed h-full and overflow-y-auto to let parent container handle scrolling. 
        // Increased padding bottom (pb-32) to ensure content is visible above nav bar on iOS.
        <div className="flex flex-col p-6 space-y-4 pb-36 animate-in fade-in duration-300">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                    <Wind className="w-6 h-6 text-ocean-500" />
                    Sea & Wind
                </h2>
                <div className="flex bg-ocean-800 rounded-lg p-1">
                    <button
                        onClick={() => setUnit('m')}
                        className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${unit === 'm' ? 'bg-ocean-500 text-white' : 'text-gray-400'}`}
                    >
                        M
                    </button>
                    <button
                        onClick={() => setUnit('ft')}
                        className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${unit === 'ft' ? 'bg-ocean-500 text-white' : 'text-gray-400'}`}
                    >
                        FT
                    </button>
                </div>
            </div>

            {/* Input Section: Conditions */}
            <div className="space-y-3">
                {/* Compact Row: Seabed + Depth */}
                <div className="grid grid-cols-2 gap-3">
                    {/* Seabed Type */}
                    <div>
                        <label className={labelStyle}>Seabed</label>
                        <div className="relative">
                            <Layers className="absolute left-3 top-3.5 w-4 h-4 text-ocean-400" />
                            <select
                                value={seabedType}
                                onChange={(e) => setSeabedType(e.target.value)}
                                className={`${inputStyle} pl-10 appearance-none`}
                            >
                                <option value="Sand">Sand</option>
                                <option value="Vase">Mud (Vase)</option>
                                <option value="Herbarium">Grass</option>
                                <option value="Rock">Rock</option>
                                <option value="Other">Other</option>
                            </select>
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-ocean-400">
                                <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                            </div>
                        </div>
                    </div>

                    {/* Depth Section */}
                    <div>
                        <label className={labelStyle}>Depth ({unit})</label>
                        <div className="relative">
                            <ArrowDown className="absolute left-3 top-3.5 w-4 h-4 text-ocean-400" />
                            <input
                                type="number"
                                value={depth}
                                onChange={(e) => setDepth(Number(e.target.value))}
                                className={`${inputStyle} pl-10`}
                                min="0"
                                step="0.5"
                            />
                        </div>
                    </div>
                </div>

                {/* Info Row for Combined inputs */}
                <div className="flex justify-between items-start -mt-2 px-1">
                     <p className="text-[10px] text-ocean-300 italic w-1/2 pr-2 leading-tight">
                        {getSeabedTip(seabedType)}
                    </p>
                    <div className="w-1/2 flex justify-end items-center gap-1 text-ocean-400">
                        <ArrowUpFromLine className="w-3 h-3" />
                        <p className="text-[10px]">
                            +<span className="text-ocean-300 font-bold">{defaultFreeboard}{unit}</span> Bow
                        </p>
                    </div>
                </div>

                {/* Wind & Swell Row */}
                <div className="grid grid-cols-2 gap-3">
                    {/* Wind Input */}
                    <div>
                        <label className={labelStyle}>Wind (Knots)</label>
                        <div className="relative">
                            <Wind className="absolute left-3 top-3.5 w-4 h-4 text-ocean-400" />
                            <input
                                type="number"
                                value={windSpeed}
                                onChange={(e) => setWindSpeed(Number(e.target.value))}
                                className={`${inputStyle} pl-10 text-lg font-bold text-ocean-100`}
                                min="0"
                            />
                        </div>
                    </div>

                    {/* Swell Input */}
                    <div>
                        <label className={labelStyle}>Swell (m)</label>
                        <div className="relative">
                            <Waves className="absolute left-3 top-3.5 w-4 h-4 text-ocean-400" />
                            <input
                                type="number"
                                value={swellHeight}
                                onChange={(e) => setSwellHeight(Number(e.target.value))}
                                className={`${inputStyle} pl-10 text-lg font-bold text-ocean-100`}
                                min="0"
                                step="0.1"
                            />
                        </div>
                    </div>
                </div>

                {/* Wind Severity Gauge */}
                <div className="mt-1">
                    <div className="flex justify-between px-1 gap-1 mb-1">
                        <div className={`h-3 flex-1 rounded-l-full transition-colors ${windSpeed < 10 ? 'bg-safe-500' : 'bg-ocean-800'}`}></div>
                        <div className={`h-3 flex-1 transition-colors ${windSpeed >= 10 && windSpeed < 20 ? 'bg-blue-500' : 'bg-ocean-800'}`}></div>
                        <div className={`h-3 flex-1 transition-colors ${windSpeed >= 20 && windSpeed < 30 ? 'bg-orange-500' : 'bg-ocean-800'}`}></div>
                        <div className={`h-3 flex-1 rounded-r-full transition-colors ${windSpeed >= 30 ? 'bg-alert-500' : 'bg-ocean-800'}`}></div>
                    </div>
                    <div className="flex justify-between text-[10px] text-ocean-400 px-1 font-bold tracking-wider">
                         <span>CALM</span>
                         <span>MODERATE</span>
                         <span>STRONG</span>
                         <span>STORM</span>
                    </div>
                </div>
            </div>

            {/* Combined Result & Verification Card */}
            <div className="bg-gradient-to-br from-ocean-800 to-ocean-900 rounded-2xl border border-ocean-700 shadow-lg overflow-hidden flex flex-col">
                <div className="p-5 pb-4 space-y-4">
                    {/* Auto Calculated Ratio Header */}
                    <div className="flex justify-between items-center border-b border-ocean-700/50 pb-2">
                        <div className="flex-1 pr-2">
                            <p className="text-ocean-400 text-xs uppercase tracking-wider font-semibold">Target Ratio</p>
                            <p className="text-[10px] text-gray-500 break-words leading-tight">
                                Base {ratioBreakdown.base} (Wind) {ratioBreakdown.swell > 0 ? `+ ${ratioBreakdown.swell} (Swell)` : ''}
                                {ratioBreakdown.seabed > 1.0 ? <span className="text-orange-400"> × {ratioBreakdown.seabed.toFixed(2)} (Seabed)</span> : ''}
                            </p>
                        </div>
                        <div className="px-3 py-1 bg-ocean-950 rounded-lg border border-ocean-700 flex-shrink-0">
                            <span className="text-lg font-bold text-ocean-200">{recommendedScope}:1</span>
                        </div>
                    </div>

                    {/* Comparison Grid: Required vs Actual */}
                    <div className="grid grid-cols-2 gap-4 items-end">
                        {/* Left: Required */}
                        <div className="flex flex-col">
                            <p className="text-white text-xs font-bold uppercase tracking-wider mb-1">Required</p>
                            <div className="flex items-baseline">
                                <span className="text-4xl font-bold text-white tracking-tighter">{requiredLength.toFixed(1)}</span>
                                <span className="text-sm text-ocean-400 ml-1 font-medium">{unit}</span>
                            </div>
                        </div>

                        {/* Right: Actual Input */}
                        <div className="flex flex-col">
                            <label className="text-ocean-400 text-xs font-bold uppercase tracking-wider mb-1 flex items-center justify-between">
                                <span className="flex items-center gap-1"><Link className="w-3 h-3" /> Deployed</span>
                                {isMaxedOut && <span className="text-orange-500 flex items-center gap-1"><AlertTriangle className="w-3 h-3"/> MAX</span>}
                            </label>
                            <input
                                type="number"
                                value={actualLength}
                                onChange={(e) => handleDeployedChange(Number(e.target.value))}
                                className={`w-full bg-ocean-900/50 border-2 rounded-lg p-2 text-right text-2xl font-bold text-white focus:outline-none focus:ring-2 transition-all font-mono ${
                                    isMaxedOut ? 'border-orange-500 focus:ring-orange-500/50' : 
                                    actualLength > 0 
                                        ? (shortage > 0 ? 'border-alert-500 focus:ring-alert-500/50' : 'border-safe-500 focus:ring-safe-500/50') 
                                        : 'border-ocean-600 focus:ring-ocean-500'
                                }`}
                                placeholder="0"
                                min="0"
                            />
                        </div>
                    </div>
                </div>

                {/* Integrated Validation Message (Bottom of Card) */}
                {actualLength > 0 && (
                    <div className={`px-5 py-3 border-t flex items-start gap-3 transition-colors duration-300 ${
                        isMaxedOut ? 'bg-orange-900/20 border-orange-500/30' :
                        shortage <= 0 
                            ? 'bg-safe-900/20 border-safe-500/30' 
                            : 'bg-alert-900/20 border-alert-500/30'
                    }`}>
                        {isMaxedOut ? <AlertTriangle className="w-5 h-5 text-orange-500 mt-0.5 flex-shrink-0" /> :
                         shortage <= 0 
                            ? <CheckCircle className="w-5 h-5 text-safe-500 mt-0.5 flex-shrink-0" />
                            : <AlertTriangle className="w-5 h-5 text-alert-500 mt-0.5 flex-shrink-0" />
                        }
                        <div className="flex-1">
                            <h4 className={`font-bold text-sm ${
                                isMaxedOut ? 'text-orange-500' :
                                shortage <= 0 ? 'text-safe-500' : 'text-alert-500'
                            }`}>
                                {isMaxedOut ? 'Capacity Limit Reached' : (shortage <= 0 ? 'Safe Scope' : 'Insufficient Chain')}
                            </h4>
                            <p className="text-xs text-gray-300 mt-0.5 leading-snug">
                                {isMaxedOut ? (
                                    <>Your boat only has <strong className="text-white">{maxChainLength}m</strong> of chain.</>
                                ) : (
                                    shortage <= 0 ? (
                                        <>Secure. You have <strong className="text-white">{Math.abs(shortage).toFixed(1)}{unit}</strong> extra.</>
                                    ) : (
                                        <>Short by <strong className="text-alert-400">{shortage.toFixed(1)}{unit}</strong>. Extend to {requiredLength.toFixed(1)}{unit}.</>
                                    )
                                )}
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ScopeCalculator;
