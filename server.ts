import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import Database from 'better-sqlite3';
import axios from 'axios';
import iconv from 'iconv-lite';

const app = express();
const PORT = 3000;

// Initialize SQLite Database
const db = new Database('earthquakes.db');

// Create table if not exists
db.exec(`
  CREATE TABLE IF NOT EXISTS earthquakes (
    id TEXT PRIMARY KEY,
    date_time TEXT,
    lat REAL,
    lng REAL,
    depth REAL,
    mag REAL,
    title TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

const insertEq = db.prepare(`
  INSERT OR IGNORE INTO earthquakes (id, date_time, lat, lng, depth, mag, title)
  VALUES (@id, @date_time, @lat, @lng, @depth, @mag, @title)
`);

const getLatestEqs = db.prepare(`
  SELECT * FROM earthquakes
  ORDER BY date_time DESC
  LIMIT 500
`);

const getHistoryEqs = db.prepare(`
  SELECT * FROM earthquakes
  ORDER BY date_time DESC
  LIMIT @limit OFFSET @offset
`);

const getTotalEqsCount = db.prepare(`
  SELECT COUNT(*) as count FROM earthquakes
`);

// Function to fetch and parse KOERI data
async function fetchAndParseKOERI() {
  try {
    console.log('Fetching KOERI data...');
    const response = await axios.get('http://www.koeri.boun.edu.tr/scripts/lst0.asp', {
      responseType: 'arraybuffer'
    });
    
    // Convert buffer to string using iconv-lite for Turkish characters
    const html = iconv.decode(Buffer.from(response.data), 'win1254');

    // Extract the content inside <pre> tags
    const preMatch = html.match(/<pre>([\s\S]*?)<\/pre>/i);
    if (!preMatch) return;
    
    const text = preMatch[1];
    const lines = text.split('\n');
    
    let isData = false;
    let newCount = 0;

    const insertTransaction = db.transaction((quakes: any[]) => {
      for (const q of quakes) {
        const result = insertEq.run(q);
        if (result.changes > 0) newCount++;
      }
    });

    const parsedQuakes = [];

    for (const line of lines) {
      if (line.includes('--------------')) {
        isData = true;
        continue;
      }
      if (!isData || line.trim() === '') continue;

      const parts = line.trim().split(/\s+/);
      if (parts.length < 8) continue;

      const date = parts[0]; // 2024.03.29
      const time = parts[1]; // 11:00:00
      const lat = parseFloat(parts[2]);
      const lng = parseFloat(parts[3]);
      const depth = parseFloat(parts[4]);
      
      let mag = parseFloat(parts[6]);
      if (isNaN(mag) || mag === 0) mag = parseFloat(parts[5]);
      if (isNaN(mag) || mag === 0) mag = parseFloat(parts[7]);
      
      const title = parts.slice(8).join(' ').replace('İlksel', '').replace('REVIZE', '').trim();
      
      const dateTimeStr = `${date} ${time}`;
      const id = `${date.replace(/\./g, '')}${time.replace(/:/g, '')}_${lat}_${lng}`;

      parsedQuakes.push({
        id,
        date_time: dateTimeStr,
        lat,
        lng,
        depth,
        mag: isNaN(mag) ? 0 : mag,
        title
      });
    }

    if (parsedQuakes.length > 0) {
      insertTransaction(parsedQuakes);
      console.log(`Successfully parsed ${parsedQuakes.length} earthquakes. Inserted ${newCount} new records.`);
    }

  } catch (error) {
    console.error('Error fetching KOERI data:', error);
  }
}

// Initial fetch and then every 1 minute
fetchAndParseKOERI();
setInterval(fetchAndParseKOERI, 60 * 1000);

// API Routes
app.get('/api/earthquakes', (req, res) => {
  try {
    const data = getLatestEqs.all();
    // Map to the format expected by the frontend
    const formattedData = data.map((q: any) => ({
      earthquake_id: q.id,
      title: q.title,
      date: q.date_time,
      mag: q.mag,
      depth: q.depth,
      geojson: {
        coordinates: [q.lng, q.lat]
      }
    }));
    res.json({ result: formattedData });
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/history', (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = (page - 1) * limit;

    const data = getHistoryEqs.all({ limit, offset });
    const totalRow = getTotalEqsCount.get() as { count: number };
    const total = totalRow.count;

    const formattedData = data.map((q: any) => ({
      earthquake_id: q.id,
      title: q.title,
      date: q.date_time,
      mag: q.mag,
      depth: q.depth,
      geojson: {
        coordinates: [q.lng, q.lat]
      }
    }));

    res.json({ 
      result: formattedData,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
