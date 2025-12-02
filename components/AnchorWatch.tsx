import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Anchor, MapPin, AlertTriangle, Navigation, LocateFixed } from 'lucide-react';
import { GeoPosition, AnchorStatus } from '../types';

// Helper: Calculate distance between two coords in meters (Haversine)
const getDistance = (pos1: GeoPosition, pos2: GeoPosition) => {
    const R = 6371e3; // metres
    const φ1 = pos1.latitude * Math.PI / 180;
    const φ2 = pos2.latitude * Math.PI / 180;
    const Δφ = (pos2.latitude - pos1.latitude) * Math.PI / 180;
    const Δλ = (pos2.longitude - pos1.longitude) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
};

const AnchorWatch: React.FC = () => {
    const [currentPos, setCurrentPos] = useState<GeoPosition | null>(null);
    const [status, setStatus] = useState<AnchorStatus>({
        isDropped: false,
        dropLocation: null,
        radiusMeters: 40
    });
    const [distanceFromAnchor, setDistanceFromAnchor] = useState<number>(0);
    const [isDrifting, setIsDrifting] = useState<boolean>(false);
    const [gpsError, setGpsError] = useState<string | null>(null);
    
    const watchId = useRef<number | null>(null);

    // Audio context for alarm
    const alarmAudio = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
        // Initialize audio (silent initially) - creating element in memory
        // In a real app, we'd need user interaction to "unlock" audio context usually, 
        // but standard HTML5 audio often works if triggered by event logic later.
        // We won't implement full sound file here, but simulate the logic.
        if ('vibrate' in navigator) {
             // capability check
        }
    }, []);

    const startGps = useCallback(() => {
        if (!navigator.geolocation) {
            setGpsError("Geolocation is not supported by this device.");
            return;
        }

        watchId.current = navigator.geolocation.watchPosition(
            (position) => {
                const newPos: GeoPosition = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    speed: position.coords.speed,
                    heading: position.coords.heading,
                    timestamp: position.timestamp
                };
                setCurrentPos(newPos);
                setGpsError(null);
            },
            (error) => {
                let msg = "GPS Error.";
                if (error.code === 1) msg = "Location permission denied.";
                if (error.code === 2) msg = "Location unavailable.";
                if (error.code === 3) msg = "GPS timeout.";
                setGpsError(msg);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
    }, []);

    useEffect(() => {
        startGps();
        return () => {
            if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
        };
    }, [startGps]);

    // Monitor drift
    useEffect(() => {
        if (status.isDropped && status.dropLocation && currentPos) {
            const dist = getDistance(status.dropLocation, currentPos);
            setDistanceFromAnchor(dist);

            if (dist > status.radiusMeters) {
                setIsDrifting(true);
                if (navigator.vibrate) navigator.vibrate([500, 200, 500]);
            } else {
                setIsDrifting(false);
            }
        } else {
            setDistanceFromAnchor(0);
            setIsDrifting(false);
        }
    }, [currentPos, status]);

    const toggleAnchor = () => {
        if (status.isDropped) {
            // Weigh Anchor
            setStatus(prev => ({ ...prev, isDropped: false, dropLocation: null }));
        } else {
            // Drop Anchor
            if (!currentPos) {
                alert("Wait for GPS signal before dropping anchor.");
                return;
            }
            setStatus(prev => ({ ...prev, isDropped: true, dropLocation: currentPos }));
        }
    };

    // Radar Visualization Logic
    const radarSize = 280;
    const center = radarSize / 2;
    // Scale: Viewport covers 2.5x the radius
    const viewRadius = status.radiusMeters * 2.5; 
    const scale = (radarSize / 2) / viewRadius; // pixels per meter

    let boatX = center;
    let boatY = center;

    if (status.isDropped && status.dropLocation && currentPos) {
        // Simple equirectangular projection for small distances
        const yDist = (currentPos.latitude - status.dropLocation.latitude) * 111139; // meters lat
        // meters lon (approx at lat)
        const xDist = (currentPos.longitude - status.dropLocation.longitude) * 111139 * Math.cos(status.dropLocation.latitude * Math.PI / 180);
        
        // In SVG, Y is down. North (positive Y dist) should be Up (negative SVG Y)
        // East (positive X dist) is Right (positive SVG X)
        boatX = center + (xDist * scale);
        boatY = center - (yDist * scale);
    }

    return (
        <div className="flex flex-col h-full p-4 space-y-4 overflow-y-auto pb-24 relative">
            
            {/* Header */}
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                    <Anchor className="w-6 h-6 text-ocean-500" />
                    Anchor Watch
                </h2>
                <div className={`px-2 py-1 rounded text-xs font-bold uppercase ${currentPos ? 'bg-safe-900 text-safe-500' : 'bg-alert-900 text-alert-500'}`}>
                    {currentPos ? `GPS: ±${Math.round(currentPos.accuracy || 0)}m` : 'NO GPS'}
                </div>
            </div>

            {gpsError && (
                <div className="bg-alert-900/50 border border-alert-500 p-3 rounded-lg text-alert-500 text-sm">
                    {gpsError}
                </div>
            )}

            {/* Radar View */}
            <div className="relative w-full aspect-square max-w-[320px] mx-auto bg-ocean-900 rounded-full border-4 border-ocean-800 shadow-inner overflow-hidden">
                {/* Grid Lines */}
                <div className="absolute inset-0 opacity-20 pointer-events-none">
                     <div className="absolute top-1/2 left-0 w-full h-px bg-ocean-400"></div>
                     <div className="absolute left-1/2 top-0 w-px h-full bg-ocean-400"></div>
                </div>

                <svg width="100%" height="100%" viewBox={`0 0 ${radarSize} ${radarSize}`} className="absolute inset-0">
                    {status.isDropped && (
                        <>
                            {/* Safe Zone Circle */}
                            <circle 
                                cx={center} 
                                cy={center} 
                                r={status.radiusMeters * scale} 
                                fill="rgba(16, 185, 129, 0.1)" 
                                stroke={isDrifting ? "#ef4444" : "#10b981"} 
                                strokeWidth="2"
                                strokeDasharray={isDrifting ? "0" : "4 4"}
                            />
                            {/* Anchor Position */}
                            <circle cx={center} cy={center} r="4" fill="#ffffff" />
                        </>
                    )}
                    
                    {/* Boat Position */}
                    <g transform={`translate(${boatX}, ${boatY}) rotate(${currentPos?.heading || 0})`}>
                         {/* Boat shape */}
                         <path d="M0,-8 L6,8 L0,6 L-6,8 Z" fill={isDrifting ? "#ef4444" : "#38bdf8"} stroke="white" strokeWidth="1" />
                    </g>
                </svg>

                {isDrifting && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60 animate-pulse">
                        <div className="text-center">
                            <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-2" />
                            <h3 className="text-2xl font-bold text-red-500">DRIFT ALARM</h3>
                        </div>
                    </div>
                )}
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-2 gap-3">
                <div className="bg-ocean-800 p-3 rounded-xl border border-ocean-700 text-center">
                    <p className="text-xs text-ocean-400 uppercase">Distance</p>
                    <p className={`text-2xl font-bold ${isDrifting ? 'text-red-500' : 'text-white'}`}>
                        {Math.round(distanceFromAnchor)} <span className="text-sm font-normal">m</span>
                    </p>
                </div>
                <div className="bg-ocean-800 p-3 rounded-xl border border-ocean-700 text-center">
                    <p className="text-xs text-ocean-400 uppercase">Bearing</p>
                    <p className="text-2xl font-bold text-white">
                        {currentPos?.heading ? Math.round(currentPos.heading) + '°' : '--'}
                    </p>
                </div>
            </div>

            {/* Controls */}
            <div className="bg-ocean-800 p-4 rounded-xl border border-ocean-700 space-y-4">
                 <div>
                    <div className="flex justify-between text-sm text-ocean-300 mb-2">
                        <span>Alarm Radius</span>
                        <span>{status.radiusMeters} m</span>
                    </div>
                    <input 
                        type="range" 
                        min="10" 
                        max="100" 
                        step="5"
                        disabled={status.isDropped}
                        value={status.radiusMeters} 
                        onChange={(e) => setStatus({...status, radiusMeters: Number(e.target.value)})}
                        className={`w-full h-2 bg-ocean-600 rounded-lg appearance-none ${status.isDropped ? 'opacity-50' : 'cursor-pointer accent-ocean-500'}`}
                    />
                 </div>

                 <button
                    onClick={toggleAnchor}
                    disabled={!currentPos && !status.isDropped}
                    className={`w-full py-4 rounded-xl font-bold text-lg shadow-lg transition-all transform active:scale-95 flex justify-center items-center gap-2
                        ${status.isDropped 
                            ? 'bg-ocean-700 text-white hover:bg-ocean-600 border border-ocean-500' 
                            : 'bg-ocean-500 text-white hover:bg-ocean-400'
                        }
                        ${(!currentPos && !status.isDropped) ? 'opacity-50 cursor-not-allowed' : ''}
                    `}
                >
                    {status.isDropped ? (
                        <>
                            <Navigation className="w-5 h-5 rotate-180" />
                            Weigh Anchor (Stop)
                        </>
                    ) : (
                        <>
                            <LocateFixed className="w-5 h-5" />
                            Drop Anchor (Start)
                        </>
                    )}
                </button>
            </div>
        </div>
    );
};

export default AnchorWatch;