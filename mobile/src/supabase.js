import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://lfxzirfmktyhfuapxgxk.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxmeHppcmZta3R5aGZ1YXB4Z3hrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNDAyMTgsImV4cCI6MjA5NzYxNjIxOH0.YtS5nDs8qcjQV-I_f6Gb_iprQ_3_ey3r6WUem5NmXBU';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
