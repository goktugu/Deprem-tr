/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  AlertTriangle, 
  Activity, 
  Clock, 
  MapPin, 
  RefreshCw, 
  ChevronRight,
  Info,
  Bell
} from 'lucide-react';
import { format, subHours, isAfter } from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { supabase } from './lib/supabase';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Earthquake {
  earthquake_id: string;
  title: string;
  date: string;
  mag: number;
  depth: number;
  geojson: {
    coordinates: [number, number];
  };
}

interface ApiResponse {
  status: boolean;
  result: Earthquake[];
}

// Distance calculation between two coordinates (Haversine formula)
function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Super robust manual date parsing for various formats
const parseEqDate = (dateStr: any) => {
  if (!dateStr) return null;
  const s = String(dateStr).trim();
  
  // Try native parsing first
  const d1 = new Date(s);
  if (!isNaN(d1.getTime()) && s.includes('T')) return d1;

  // Try Kandilli/AFAD formats: "2024.03.29 11:00:00" or "29-03-2024 11:00"
  try {
    const match = s.match(/(\d{2,4})[\.\-\/](\d{1,2})[\.\-\/](\d{2,4})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
    if (match) {
      let year, month, day, hour, min, sec;
      const p1 = match[1];
      const p2 = parseInt(match[2]) - 1;
      const p3 = match[3];
      
      if (p1.length === 4) {
        year = parseInt(p1);
        day = parseInt(p3);
      } else {
        day = parseInt(p1);
        year = parseInt(p3);
      }
      month = p2;
      hour = parseInt(match[4]);
      min = parseInt(match[5]);
      sec = match[6] ? parseInt(match[6]) : 0;
      
      // Kandilli is UTC+3. To get UTC, subtract 3 hours.
      const d = new Date(Date.UTC(year, month, day, hour - 3, min, sec));
      if (!isNaN(d.getTime())) return d;
    }
  } catch (e) {}

  return null;
};

export default function App() {
  const [earthquakes, setEarthquakes] = useState<Earthquake[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [activeTab, setActiveTab] = useState<'live' | 'history'>('live');

  const [historyData, setHistoryData] = useState<Earthquake[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotalPages, setHistoryTotalPages] = useState(1);

  const fetchEarthquakes = async () => {
    setLoading(true);
    setError(null);
    
    // 1. Fetch from KOERI via proxy
    const targetUrl = 'http://www.koeri.boun.edu.tr/scripts/lst0.asp';
    const proxies = [
      `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`,
      `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`,
      `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`
    ];

    let text = '';
    let success = false;

    for (const proxyUrl of proxies) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 seconds per proxy

        const response = await fetch(proxyUrl, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (!response.ok) continue;

        if (proxyUrl.includes('allorigins.win/get')) {
          const data = await response.json();
          if (data.contents) {
            text = data.contents;
            success = true;
            break;
          }
        } else {
          text = await response.text();
          if (text && text.includes('--------------')) {
            success = true;
            break;
          }
        }
      } catch (err) {
        console.warn(`Proxy failed: ${proxyUrl}`, err);
        continue;
      }
    }

    try {
      if (success && text) {
        const lines = text.split('\n');
        let isData = false;
        const supabaseData = [];
        const parsedQuakes: Earthquake[] = [];

        for (const line of lines) {
          if (line.includes('--------------')) {
            isData = true;
            continue;
          }
          if (!isData || line.trim() === '') continue;

          const date = line.substring(0, 10).trim();
          const time = line.substring(11, 19).trim();
          const latStr = line.substring(21, 28).trim();
          const lngStr = line.substring(31, 38).trim();
          const depthStr = line.substring(46, 50).trim();
          const magStr = line.substring(60, 63).trim();
          const title = line.substring(71, 121).trim();

          const lat = parseFloat(latStr);
          const lng = parseFloat(lngStr);
          const depth = parseFloat(depthStr);
          const mag = parseFloat(magStr);

          if (!date || !time || isNaN(lat) || isNaN(lng)) continue;

          const dateTimeStr = `${date} ${time}`;
          const id = `${date.replace(/\./g, '')}${time.replace(/:/g, '')}_${lat}_${lng}`;

          supabaseData.push({
            id: id,
            date_time: dateTimeStr,
            lat: lat,
            lng: lng,
            depth: isNaN(depth) ? 0 : depth,
            mag: isNaN(mag) ? 0 : mag,
            title: title
          });
          
          parsedQuakes.push({
            earthquake_id: id,
            title: title,
            date: dateTimeStr,
            mag: isNaN(mag) ? 0 : mag,
            depth: isNaN(depth) ? 0 : depth,
            geojson: {
              coordinates: [lng, lat]
            }
          });
        }

        if (parsedQuakes.length > 0) {
          // Update UI immediately with live data
          setEarthquakes(parsedQuakes);
          setLastUpdated(new Date());
          setLoading(false); // Stop loading spinner early
          
          // Fire and forget: Upsert to Supabase in the background
          supabase
            .from('earthquakes')
            .upsert(supabaseData, { onConflict: 'id', ignoreDuplicates: true })
            .then(({ error: upsertError }) => {
              if (upsertError) {
                console.error('Supabase sync error:', upsertError);
              }
            });
        }
      }

      // If user is on history tab, refresh history from Supabase
      if (activeTab === 'history') {
        loadHistoryFromSupabase(historyPage);
      }
      
    } catch (err: any) {
      setError(err.message || 'Deprem verileri yüklenirken bir hata oluştu.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadHistoryFromSupabase = async (page: number = 1) => {
    setHistoryLoading(true);
    
    try {
      const limit = 50;
      const start = (page - 1) * limit;
      const end = start + limit - 1;

      const { data, error, count } = await supabase
        .from('earthquakes')
        .select('*', { count: 'exact' })
        .order('date_time', { ascending: false })
        .range(start, end);

      if (error) throw error;

      const mappedData: Earthquake[] = (data || []).map(row => ({
        earthquake_id: row.id,
        title: row.title,
        date: row.date_time,
        mag: row.mag,
        depth: row.depth,
        geojson: {
          coordinates: [row.lng, row.lat]
        }
      }));

      setHistoryData(mappedData);
      setHistoryTotalPages(Math.ceil((count || 0) / limit));
    } catch (err: any) {
      console.error('Supabase load error:', err);
      setError('Geçmiş veriler veritabanından alınamadı.');
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    fetchEarthquakes();
    const interval = setInterval(fetchEarthquakes, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (activeTab === 'history') {
      loadHistoryFromSupabase(historyPage);
    }
  }, [activeTab, historyPage]);

  const paginatedHistory = historyData; // We now fetch paginated data directly from Supabase

  const getEqDateParts = (eq: any) => {
    const s = eq.date || eq.date_time || eq.tarih || '';
    if (!s) return { date: '----.--.--', time: '--:--:--' };
    
    // Handle "YYYY.MM.DD HH:MM:SS"
    if (s.includes(' ')) {
      const parts = s.split(' ');
      return { date: parts[0], time: parts[1] };
    }
    
    // Handle ISO "YYYY-MM-DDTHH:MM:SS"
    if (s.includes('T')) {
      const parts = s.split('T');
      return { date: parts[0], time: parts[1].replace('Z', '') };
    }

    return { date: s, time: '--:--:--' };
  };

  // Audit & Clustering Logic
  const { alerts, stats, diagnostics, rawSample, processedQuakes, importantQuakes } = useMemo(() => {
    if (earthquakes.length === 0) return { alerts: [], stats: { total: 0, recent: 0, recentMag3Plus: 0, reference: null }, diagnostics: [], rawSample: '', processedQuakes: [], importantQuakes: [] };

    // 1. Parse all dates and find reference
    const parsedData = earthquakes.map(q => {
      const rawDate = q.date || (q as any).date_time || (q as any).tarih;
      return {
        ...q,
        parsedDate: parseEqDate(rawDate)
      };
    });

    const validDates = parsedData.filter(d => d.parsedDate !== null) as (Earthquake & { parsedDate: Date })[];
    
    // Reference time is the latest quake in the data
    const referenceTime = validDates.length > 0 
      ? new Date(Math.max(...validDates.map(d => d.parsedDate.getTime()))) 
      : new Date();
    
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;
    const referenceMs = referenceTime.getTime();
    
    // 2. Filter quakes within 24 hours of reference
    const recentQuakes = validDates.filter(d => {
      return (referenceMs - d.parsedDate.getTime()) <= twentyFourHoursMs;
    });

    const importantQuakesList = recentQuakes
      .filter(q => q.mag >= 3)
      .sort((a, b) => b.parsedDate.getTime() - a.parsedDate.getTime());

    const recentMag3Plus = importantQuakesList.length;

    const clusters: { id: string; location: string; count: number; maxMag: number; latest: Earthquake }[] = [];
    const processedIds = new Set<string>();

    // 3. Sort by magnitude to find cluster centers
    const sortedQuakes = [...recentQuakes].sort((a, b) => b.mag - a.mag);

    sortedQuakes.forEach(q => {
      if (processedIds.has(q.earthquake_id)) return;

      const lat1 = parseFloat(String(q.geojson?.coordinates[1] || (q as any).lat || 0));
      const lon1 = parseFloat(String(q.geojson?.coordinates[0] || (q as any).lng || 0));
      
      if (lat1 === 0 || lon1 === 0) return;

      const neighbors = recentQuakes.filter(other => {
        const lat2 = parseFloat(String(other.geojson?.coordinates[1] || (other as any).lat || 0));
        const lon2 = parseFloat(String(other.geojson?.coordinates[0] || (other as any).lng || 0));
        if (lat2 === 0 || lon2 === 0) return false;
        return getDistance(lat1, lon1, lat2, lon2) <= 20;
      });

      if (neighbors.length >= 3) {
        clusters.push({
          id: q.earthquake_id,
          location: q.title || 'Bilinmeyen Bölge',
          count: neighbors.length,
          maxMag: Math.max(...neighbors.map(n => n.mag)),
          latest: [...neighbors].sort((a, b) => b.parsedDate.getTime() - a.parsedDate.getTime())[0]
        });
        
        neighbors.forEach(n => processedIds.add(n.earthquake_id));
      }
    });

    return { 
      alerts: clusters.sort((a, b) => b.count - a.count), 
      stats: {
        total: earthquakes.length,
        recent: recentQuakes.length,
        recentMag3Plus,
        reference: referenceTime
      },
      diagnostics: earthquakes.slice(0, 5).map(q => {
        const rawDate = q.date || (q as any).date_time || (q as any).tarih;
        const pd = parseEqDate(rawDate);
        return {
          title: q.title,
          rawDate: String(rawDate),
          parsed: pd ? format(pd, 'HH:mm:ss') : 'BAŞARISIZ',
          lat: parseFloat(String(q.geojson?.coordinates[1] || (q as any).lat || 0)),
          lng: parseFloat(String(q.geojson?.coordinates[0] || (q as any).lng || 0))
        };
      }),
      rawSample: JSON.stringify(earthquakes[0]).slice(0, 200),
      processedQuakes: parsedData,
      importantQuakes: importantQuakesList
    };
  }, [earthquakes]);

  const getMagColor = (mag: number) => {
    if (mag < 3) return 'text-emerald-500 bg-emerald-50 border-emerald-100';
    if (mag < 4) return 'text-amber-500 bg-amber-50 border-amber-100';
    if (mag < 5) return 'text-orange-500 bg-orange-50 border-orange-100';
    return 'text-red-500 bg-red-50 border-red-100';
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans selection:bg-red-100">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100 px-4 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-red-600 rounded-xl flex items-center justify-center shadow-lg shadow-red-200">
              <Activity className="text-white w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Deprem Takip</h1>
              <p className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">Türkiye Canlı Veri</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-lg">
            <button
              onClick={() => setActiveTab('live')}
              className={cn(
                "px-4 py-1.5 text-sm font-medium rounded-md transition-all",
                activeTab === 'live' ? "bg-white text-red-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
              )}
            >
              Canlı Takip
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={cn(
                "px-4 py-1.5 text-sm font-medium rounded-md transition-all",
                activeTab === 'history' ? "bg-white text-red-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
              )}
            >
              Geçmiş Depremler
            </button>
          </div>

          <button 
            onClick={fetchEarthquakes}
            disabled={loading || historyLoading}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("w-5 h-5 text-gray-600", (loading || historyLoading) && "animate-spin")} />
          </button>
        </div>
      </header>

      {activeTab === 'live' && (
        <main className="max-w-5xl mx-auto px-4 py-8 space-y-8">
          
          {/* Alerts Section */}
          <section className="space-y-4">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-red-500" />
                <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">Kümelenme Uyarıları</h2>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-gray-400 font-medium">
                <Clock className="w-3 h-3" />
                Son 24 Saatte {stats.recent} Deprem (<span className="text-amber-600 font-bold">{stats.recentMag3Plus} ≥ 3.0</span>)
              </div>
            </div>

            <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-3 space-y-2">
              <div className="flex items-start gap-3">
                <Info className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                <p className="text-[11px] text-blue-700 leading-relaxed">
                  <strong>Kriter:</strong> Son 24 saat içinde <strong>20 km çapındaki bir alan</strong> içerisinde, büyüklük fark etmeksizin <strong>3 veya daha fazla</strong> deprem gerçekleştiğinde burada listelenir.
                </p>
              </div>
              {stats.reference && (
                <div className="pt-2 border-t border-blue-100 grid grid-cols-2 gap-2 text-[9px] text-blue-400 font-mono uppercase">
                  <span>Referans Zaman: {format(stats.reference, 'HH:mm:ss')}</span>
                  <span>Taranan (Son 24s): {stats.recent} Deprem</span>
                </div>
              )}
            </div>
            
            <AnimatePresence mode="popLayout">
              {alerts.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {alerts.map((alert) => (
                    <motion.div
                      key={alert.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className={cn(
                        "border-l-4 rounded-xl p-2 shadow-sm flex items-center justify-between gap-2",
                        alert.maxMag >= 4 ? "bg-red-50/30 border-red-500" : 
                        alert.maxMag >= 3 ? "bg-amber-50/30 border-amber-500" : 
                        "bg-white border-gray-400"
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={cn(
                          "p-1 rounded-lg shrink-0",
                          alert.maxMag >= 4 ? "bg-red-50" : 
                          alert.maxMag >= 3 ? "bg-amber-50" : 
                          "bg-gray-50"
                        )}>
                          <AlertTriangle className={cn(
                            "w-3 h-3",
                            alert.maxMag >= 4 ? "text-red-600" : 
                            alert.maxMag >= 3 ? "text-amber-600" : 
                            "text-gray-600"
                          )} />
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-bold text-xs leading-tight truncate">{alert.location}</h3>
                          <p className="text-gray-500 text-[10px] mt-0.5 flex items-center gap-1">
                            <span className="font-bold text-red-600">{alert.count}</span> deprem.
                            {alert.maxMag >= 3 && (
                              <span className="text-[8px] font-black text-amber-600 bg-amber-50 px-1 rounded border border-amber-100">3.0+</span>
                            )}
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={cn(
                          "text-[8px] font-bold px-1.5 py-0.5 rounded uppercase",
                          alert.maxMag >= 4 ? "bg-red-50 text-red-600" : 
                          alert.maxMag >= 3 ? "bg-amber-50 text-amber-600" : 
                          "bg-gray-100 text-gray-600"
                        )}>
                          M: {alert.maxMag}
                        </span>
                        <span className="text-[8px] font-bold bg-gray-100 px-1.5 py-0.5 rounded text-gray-600 uppercase">
                          S: {getEqDateParts(alert.latest).time.slice(0, 5)}
                        </span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </AnimatePresence>

            {/* Important Quakes (3.0+) */}
            {importantQuakes.length > 0 && (
              <div className="space-y-3 pt-2">
                <div className="flex items-center gap-2 px-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  <h3 className="text-[11px] font-black uppercase tracking-wider text-gray-500">Önemli Depremler (3.0+)</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  {importantQuakes.slice(0, 6).map((eq) => (
                    <motion.div
                      key={eq.earthquake_id}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="bg-white border border-amber-100 rounded-lg p-2 flex items-center justify-between gap-2 shadow-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <h4 className="font-bold text-[10px] truncate leading-tight">{eq.title}</h4>
                        <p className="text-[9px] text-gray-400 font-medium">{getEqDateParts(eq).time.slice(0, 5)}</p>
                      </div>
                      <div className={cn(
                        "text-[10px] font-black px-1.5 py-0.5 rounded shrink-0",
                        eq.mag >= 4 ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"
                      )}>
                        {eq.mag.toFixed(1)}
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {alerts.length === 0 && importantQuakes.length === 0 && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bg-white border border-dashed border-gray-200 rounded-2xl p-8 text-center"
              >
                <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Activity className="w-6 h-6 text-gray-300" />
                </div>
                <p className="text-gray-400 text-sm font-medium">Şu an için herhangi bir kümelenme veya önemli deprem tespit edilmedi.</p>
              </motion.div>
            )}
          </section>

          {/* Recent Earthquakes List */}
          <section className="space-y-4">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-gray-400" />
                <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">
                  Son Depremler ({earthquakes.length})
                </h2>
              </div>
              <div className="text-[10px] font-mono text-gray-400">
                Son Güncelleme: {format(lastUpdated, 'HH:mm:ss')}
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-100 text-red-600 p-4 rounded-xl text-sm flex items-center gap-3">
                <Info className="w-5 h-5 shrink-0" />
                {error}
              </div>
            )}

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              {loading && earthquakes.length === 0 ? (
                <div className="p-12 text-center space-y-4">
                  <RefreshCw className="w-8 h-8 text-red-500 animate-spin mx-auto" />
                  <p className="text-gray-400 text-sm">Veriler güncelleniyor...</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {processedQuakes.slice(0, 100).map((eq) => (
                    <motion.div 
                      key={eq.earthquake_id}
                      layout
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="group hover:bg-gray-50 transition-colors p-4 md:p-6 flex items-center gap-4 md:gap-8"
                    >
                      {/* Magnitude Badge */}
                      <div className={cn(
                        "w-14 h-14 shrink-0 rounded-2xl border flex flex-col items-center justify-center transition-transform group-hover:scale-105",
                        getMagColor(eq.mag)
                      )}>
                        <span className="text-xl font-black leading-none">{eq.mag.toFixed(1)}</span>
                        <span className="text-[8px] font-bold uppercase mt-1 opacity-70">ML</span>
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <h3 className="font-bold tracking-tight text-[10px] sm:text-xs md:text-base lg:text-lg truncate group-hover:text-red-600 transition-colors">
                          {eq.title}
                        </h3>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
                          <div className="flex items-center gap-1.5 text-gray-400">
                            <Clock className="w-3.5 h-3.5" />
                            <div className="flex flex-col">
                              <span className="text-sm font-black text-gray-900">
                                {eq.parsedDate ? format(eq.parsedDate, 'HH:mm:ss') : getEqDateParts(eq).time}
                              </span>
                              <span className="text-[10px] font-bold text-gray-500">
                                {eq.parsedDate ? format(eq.parsedDate, 'yyyy.MM.dd') : getEqDateParts(eq).date}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 text-gray-400">
                            <MapPin className="w-3.5 h-3.5" />
                            <span className="text-xs font-medium">Derinlik: {eq.depth} km</span>
                          </div>
                        </div>
                      </div>

                      <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-gray-400 transition-colors" />
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </main>
      )}

      {activeTab === 'history' && (
        <main className="max-w-5xl mx-auto px-4 py-8 space-y-8">
          <section className="space-y-4">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">Geçmiş Deprem Arşivi</h2>
              <div className="flex items-center gap-2 text-[10px] text-gray-400 font-medium">
                <RefreshCw className={cn("w-3 h-3", historyLoading && "animate-spin")} />
                {historyLoading ? 'Yükleniyor...' : `Sayfa ${historyPage} / ${historyTotalPages}`}
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              {historyLoading && historyData.length === 0 ? (
                <div className="p-12 text-center space-y-4">
                  <RefreshCw className="w-8 h-8 text-red-500 animate-spin mx-auto" />
                  <p className="text-gray-400 text-sm">Arşiv yükleniyor...</p>
                </div>
              ) : (
                <>
                  <div className="divide-y divide-gray-50">
                    {paginatedHistory.map((eq) => (
                      <div 
                        key={eq.earthquake_id}
                        className="group hover:bg-gray-50 transition-colors p-4 md:p-6 flex items-center gap-4 md:gap-8"
                      >
                        {/* Magnitude Badge */}
                        <div className={cn(
                          "w-14 h-14 shrink-0 rounded-2xl border flex flex-col items-center justify-center transition-transform group-hover:scale-105",
                          getMagColor(eq.mag)
                        )}>
                          <span className="text-xl font-black leading-none">{eq.mag.toFixed(1)}</span>
                          <span className="text-[8px] font-bold uppercase mt-1 opacity-70">ML</span>
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <h3 className="font-bold tracking-tight text-[10px] sm:text-xs md:text-base lg:text-lg truncate group-hover:text-red-600 transition-colors">
                            {eq.title}
                          </h3>
                          
                          <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2">
                            <div className="flex items-center gap-1.5 text-gray-500">
                              <Clock className="w-3.5 h-3.5" />
                              <div className="flex items-baseline gap-1.5">
                                <span className="text-sm font-medium text-gray-900">{getEqDateParts(eq).time}</span>
                                <span className="text-xs">{getEqDateParts(eq).date}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 text-gray-400">
                              <MapPin className="w-3.5 h-3.5" />
                              <span className="text-xs font-medium">Derinlik: {eq.depth} km</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  {/* Pagination Controls */}
                  <div className="p-4 border-t border-gray-100 flex items-center justify-between bg-gray-50">
                    <button 
                      onClick={() => setHistoryPage(p => Math.max(1, p - 1))}
                      disabled={historyPage === 1 || historyLoading}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Önceki Sayfa
                    </button>
                    <span className="text-sm text-gray-500 font-medium">
                      Sayfa {historyPage} / {historyTotalPages}
                    </span>
                    <button 
                      onClick={() => setHistoryPage(p => Math.min(historyTotalPages, p + 1))}
                      disabled={historyPage === historyTotalPages || historyLoading}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Sonraki Sayfa
                    </button>
                  </div>
                </>
              )}
            </div>
          </section>
        </main>
      )}

      {/* Footer */}
      <footer className="max-w-5xl mx-auto px-4 py-12 text-center space-y-6">
        <button 
          onClick={() => setShowDiagnostics(!showDiagnostics)}
          className="text-[9px] text-gray-300 hover:text-gray-500 transition-colors uppercase tracking-widest"
        >
          {showDiagnostics ? 'Tanılama Panelini Gizle' : 'Sistem Tanılama'}
        </button>

        {showDiagnostics && (
          <div className="bg-gray-100 rounded-xl p-4 text-left font-mono text-[10px] text-gray-500 space-y-2 overflow-auto max-h-96">
            <p className="font-bold text-gray-700">Sistem Tanılama Verileri:</p>
            
            <div className="p-2 bg-gray-200 rounded mb-2 break-all">
              <p className="font-bold mb-1">Ham Veri Örneği:</p>
              {rawSample}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p>Toplam Veri: {stats.total}</p>
                <p>Filtrelenen (24s): {stats.recent}</p>
                <p>3.0+ Deprem: {stats.recentMag3Plus}</p>
                <p>Referans: {stats.reference ? format(stats.reference, 'yyyy-MM-dd HH:mm:ss') : 'Yok'}</p>
                <p className="text-[8px] mt-1 text-gray-400 truncate">URL: /api/earthquakes (Local DB)</p>
              </div>
              <div>
                <p>Aktif Uyarı: {alerts.length}</p>
                <p>Yarıçap: 20km</p>
              </div>
            </div>
            <div className="mt-2 pt-2 border-t border-gray-200">
              <p className="font-bold mb-1 text-gray-700">Veri Örnekleri (İlk 5):</p>
              {diagnostics.map((d, i) => (
                <div key={i} className="mb-2 border-b border-gray-200 pb-1 last:border-0">
                  <div className="flex justify-between">
                    <span className="text-gray-800 font-bold">{d.title}</span>
                    <span className={d.parsed === 'BAŞARISIZ' ? 'text-red-500' : 'text-green-600'}>
                      P: {d.parsed}
                    </span>
                  </div>
                  <div className="flex justify-between text-[8px]">
                    <span>Ham: {d.rawDate}</span>
                    <span>Lat: {d.lat} Lng: {d.lng}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-center gap-4 opacity-30 grayscale">
          <img src="https://picsum.photos/seed/kandilli/100/40" alt="Kandilli Logo" className="h-6" referrerPolicy="no-referrer" />
          <div className="w-px h-4 bg-gray-400" />
          <img src="https://picsum.photos/seed/afad/100/40" alt="AFAD Logo" className="h-6" referrerPolicy="no-referrer" />
        </div>
        <p className="text-[10px] text-gray-400 font-medium uppercase tracking-[0.2em]">
          Veriler Kandilli Rasathanesi tarafından sağlanmaktadır.
        </p>
      </footer>
    </div>
  );
}
