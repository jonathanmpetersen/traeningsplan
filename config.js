// Supabase-forbindelse (udfyldes i opgave 4).
// Her må KUN stå projektets URL og den offentlige "anon"/"publishable" nøgle.
// Det er sikkert, fordi Row Level Security i databasen beskytter dine data.
// Læg ALDRIG "service_role"-nøglen her.
window.TP_CONFIG = {
  supabaseUrl: 'https://qdmyolaucjykebhipgae.supabase.co',
  supabaseAnonKey: 'sb_publishable_2Dzksi8u3R1JcHTlDyCsbw_XLSW8tBY',
  // Offentlig nøgle til notifikationer (Web Push). Den private nøgle ligger kun som hemmelighed i Supabase.
  vapidPublicKey: 'BH9VzCX39PnHqytJR_trCwMYcnBMP3bmLzH7Et9heRZ1fFoZG1_vHnhO9x9Htpc6-iKZpXqmLiLgDtVd100SLBU',
};
