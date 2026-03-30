import { createClient } from '@supabase/supabase-js';
import iconv from 'iconv-lite';

const supabaseUrl = 'https://vihvkniynajqqisubyda.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpaHZrbml5bmFqcXFpc3VieWRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4NzkzMTgsImV4cCI6MjA5MDQ1NTMxOH0.xPLTAiqpEKQvCq4Tnuu_EICajHniJcLA_isJkIJrlLk';
const supabase = createClient(supabaseUrl, supabaseKey);

async function syncEarthquakes() {
  console.log('Kandilli Rasathanesinden veriler çekiliyor...');
  try {
    // GitHub Actions (Node.js) ortamında çalıştığımız için CORS problemi yok!
    // Doğrudan Kandilli'nin kendi adresinden çekebiliriz.
    const response = await fetch('http://www.koeri.boun.edu.tr/scripts/lst0.asp');
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Kandilli Türkçe karakterleri windows-1254 formatında veriyor, bunu UTF-8'e çeviriyoruz
    const text = iconv.decode(buffer, 'win1254');

    const lines = text.split('\n');
    let isData = false;
    const supabaseData = [];

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
    }

    if (supabaseData.length > 0) {
      console.log(`${supabaseData.length} adet deprem bulundu. Supabase'e kaydediliyor...`);
      
      const { error } = await supabase
        .from('earthquakes')
        .upsert(supabaseData, { onConflict: 'id', ignoreDuplicates: true });
        
      if (error) {
        console.error('Supabase kayıt hatası:', error);
        process.exit(1);
      } else {
        console.log('Başarıyla Supabase veritabanına senkronize edildi!');
      }
    }
  } catch (error) {
    console.error('Senkronizasyon sırasında hata oluştu:', error);
    process.exit(1);
  }
}

syncEarthquakes();
