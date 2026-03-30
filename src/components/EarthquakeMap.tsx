import { useState, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { X, Clock, MapPin, Activity } from 'lucide-react';
import { format, subHours, isAfter } from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface Earthquake {
  earthquake_id: string;
  title: string;
  date: string;
  mag: number;
  depth: number;
  geojson: {
    coordinates: [number, number];
  };
}

interface EarthquakeMapProps {
  earthquakes: Earthquake[];
  onClose: () => void;
  parseEqDate: (dateStr: any) => Date | null;
}

const getMagColor = (mag: number) => {
  if (mag < 3) return 'bg-emerald-500 border-emerald-600 text-white';
  if (mag < 4) return 'bg-amber-500 border-amber-600 text-white';
  if (mag < 5) return 'bg-orange-500 border-orange-600 text-white';
  return 'bg-red-500 border-red-600 text-white';
};

const createCustomIcon = (mag: number) => {
  const size = Math.max(24, Math.min(48, mag * 8)); // Scale size based on magnitude
  const colorClass = getMagColor(mag);
  
  return L.divIcon({
    className: 'custom-div-icon',
    html: `<div class="flex items-center justify-center rounded-full border-2 shadow-md ${colorClass}" style="width: ${size}px; height: ${size}px; font-size: ${size * 0.4}px; font-weight: bold;">
            ${mag.toFixed(1)}
           </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2]
  });
};

export default function EarthquakeMap({ earthquakes, onClose, parseEqDate }: EarthquakeMapProps) {
  const [filter, setFilter] = useState<'24h' | '72h'>('24h');

  const filteredEarthquakes = useMemo(() => {
    const now = new Date();
    const cutoffDate = subHours(now, filter === '24h' ? 24 : 72);

    return earthquakes.filter(eq => {
      const eqDate = parseEqDate(eq.date);
      if (!eqDate) return false;
      return isAfter(eqDate, cutoffDate);
    });
  }, [earthquakes, filter, parseEqDate]);

  // Center on Turkey
  const center: [number, number] = [39.0, 35.0];

  return (
    <div className="fixed inset-0 z-[100] bg-white flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-white shadow-sm z-[1000]">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold">Deprem Haritası</h2>
          <div className="flex bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setFilter('24h')}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded-md transition-all",
                filter === '24h' ? "bg-white text-red-600 shadow-sm" : "text-gray-500"
              )}
            >
              Son 24 Saat
            </button>
            <button
              onClick={() => setFilter('72h')}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded-md transition-all",
                filter === '72h' ? "bg-white text-red-600 shadow-sm" : "text-gray-500"
              )}
            >
              Son 72 Saat
            </button>
          </div>
        </div>
        <button 
          onClick={onClose}
          className="p-2 hover:bg-gray-100 rounded-full transition-colors"
        >
          <X className="w-6 h-6 text-gray-600" />
        </button>
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        <MapContainer 
          center={center} 
          zoom={6} 
          className="w-full h-full"
          zoomControl={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          />
          
          {filteredEarthquakes.map(eq => {
            const lat = eq.geojson.coordinates[1];
            const lng = eq.geojson.coordinates[0];
            const eqDate = parseEqDate(eq.date);
            
            return (
              <Marker 
                key={eq.earthquake_id} 
                position={[lat, lng]}
                icon={createCustomIcon(eq.mag)}
              >
                <Popup className="rounded-xl">
                  <div className="p-1 min-w-[200px]">
                    <h3 className="font-bold text-sm mb-2 leading-tight">{eq.title}</h3>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-xs text-gray-600">
                        <Activity className="w-3.5 h-3.5 text-red-500" />
                        <span className="font-semibold">Büyüklük: {eq.mag.toFixed(1)} ML</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-600">
                        <MapPin className="w-3.5 h-3.5 text-blue-500" />
                        <span>Derinlik: {eq.depth} km</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-600">
                        <Clock className="w-3.5 h-3.5 text-amber-500" />
                        <span>{eqDate ? format(eqDate, 'dd.MM.yyyy HH:mm:ss') : eq.date}</span>
                      </div>
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
        
        {/* Floating Stats */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000] bg-white/90 backdrop-blur-md px-4 py-2 rounded-full shadow-lg border border-gray-100 text-xs font-semibold text-gray-700 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          {filteredEarthquakes.length} deprem gösteriliyor
        </div>
      </div>
    </div>
  );
}
