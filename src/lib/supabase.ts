import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://vihvkniynajqqisubyda.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpaHZrbml5bmFqcXFpc3VieWRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4NzkzMTgsImV4cCI6MjA5MDQ1NTMxOH0.xPLTAiqpEKQvCq4Tnuu_EICajHniJcLA_isJkIJrlLk';

export const supabase = createClient(supabaseUrl, supabaseKey);
