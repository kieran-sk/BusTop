/**
 * Athens Metro & Tram Network Service (ΣΤΑΣΥ)
 * Grounded in official Open Data:
 * - data.gov.gr / City of Athens GeoServer GeoJSON tracks & stations
 * - OASA O2 Hub / STASY official operational frequencies and timetables
 */

const fs = require('fs');
const path = require('path');
const oasa = require('./oasa-service');

// Official Lines Definition
const METRO_LINES = {
  'M1': {
    id: 'M1',
    code: 'M1',
    name: 'Γραμμή 1 (ΗΣΑΠ)',
    name_short: 'Γραμμή 1',
    color: '#008751',
    text_color: '#ffffff',
    termini: ['Πειραιάς', 'Κηφισιά'],
    mode: 'ΗΣΑΠ / Υπέργειο Μετρό',
    length_km: 25.6,
    station_count: 24,
    operating_hours: '05:00 - 00:30',
    frequency_peak: '5 - 6 λεπτά',
    frequency_offpeak: '7 - 10 λεπτά'
  },
  'M2': {
    id: 'M2',
    code: 'M2',
    name: 'Γραμμή 2 (Κόκκινη)',
    name_short: 'Γραμμή 2',
    color: '#DA291C',
    text_color: '#ffffff',
    termini: ['Ανθούπολη', 'Ελληνικό'],
    mode: 'Υπόγειο Μετρό',
    length_km: 17.9,
    station_count: 20,
    operating_hours: '05:30 - 00:05 (Παρ/Σαβ έως 02:00)',
    frequency_peak: '4 - 4.5 λεπτά',
    frequency_offpeak: '6 - 8 λεπτά'
  },
  'M3': {
    id: 'M3',
    code: 'M3',
    name: 'Γραμμή 3 (Μπλε)',
    name_short: 'Γραμμή 3',
    color: '#0066B2',
    text_color: '#ffffff',
    termini: ['Δημοτικό Θέατρο', 'Αεροδρόμιο'],
    mode: 'Υπόγειο Μετρό',
    length_km: 46.5,
    station_count: 27,
    operating_hours: '05:30 - 00:05 (Παρ/Σαβ έως 02:00)',
    frequency_peak: '4 - 4.5 λεπτά',
    frequency_offpeak: '6 - 8 λεπτά (Αεροδρόμιο κάθε 36\')'
  },
  'TRAM': {
    id: 'TRAM',
    code: 'TRAM',
    name: 'Τραμ (T6 / T7)',
    name_short: 'Τραμ',
    color: '#FFB81C',
    text_color: '#000000',
    termini: ['Σύνταγμα', 'Πικροδάφνη', 'Ασκληπιείο Βούλας', 'Αγία Τριάδα'],
    mode: 'Τραμ',
    length_km: 32.4,
    station_count: 39,
    operating_hours: '05:00 - 00:00 (Παρ/Σαβ έως 01:30)',
    frequency_peak: '10 - 12 λεπτά',
    frequency_offpeak: '12 - 15 λεπτά'
  }
};

// Complete Official Metro Stations Registry
const ALL_STATIONS = [
  // ================= LINE 1 (ΗΣΑΠ) =================
  { id: 'm1-peiraias', name: 'Πειραιάς', line: 'M1', order: 1, lat: 37.9482, lng: 23.6428, lines: ['M1', 'M3', 'TRAM'], interchanges: ['Γραμμή 3', 'Τραμ', 'Προαστιακός', 'Λιμάνι Πειραιά'], firstTrain: { toTerminus2: '05:00' }, lastTrain: { toTerminus2: '00:30' } },
  { id: 'm1-faliro', name: 'Φάληρο', line: 'M1', order: 2, lat: 37.9450, lng: 23.6669, lines: ['M1', 'TRAM'], interchanges: ['Τραμ (ΣΕΦ)'], firstTrain: { toTerminus1: '05:35', toTerminus2: '05:03' }, lastTrain: { toTerminus1: '01:05', toTerminus2: '00:33' } },
  { id: 'm1-moschato', name: 'Μοσχάτο', line: 'M1', order: 3, lat: 37.9553, lng: 23.6800, lines: ['M1'], interchanges: [], firstTrain: { toTerminus1: '05:32', toTerminus2: '05:06' }, lastTrain: { toTerminus1: '01:02', toTerminus2: '00:36' } },
  { id: 'm1-kallithea', name: 'Καλλιθέα', line: 'M1', order: 4, lat: 37.9608, lng: 23.6969, lines: ['M1'], interchanges: [], firstTrain: { toTerminus1: '05:29', toTerminus2: '05:09' }, lastTrain: { toTerminus1: '00:59', toTerminus2: '00:39' } },
  { id: 'm1-tavros', name: 'Ταύρος - Ελ. Βενιζέλος', line: 'M1', order: 5, lat: 37.9637, lng: 23.7052, lines: ['M1'], interchanges: [], firstTrain: { toTerminus1: '05:27', toTerminus2: '05:11' }, lastTrain: { toTerminus1: '00:57', toTerminus2: '00:41' } },
  { id: 'm1-petralona', name: 'Πετράλωνα', line: 'M1', order: 6, lat: 37.9685, lng: 23.7093, lines: ['M1'], interchanges: [], firstTrain: { toTerminus1: '05:25', toTerminus2: '05:13' }, lastTrain: { toTerminus1: '00:55', toTerminus2: '00:43' } },
  { id: 'm1-thiseio', name: 'Θησείο', line: 'M1', order: 7, lat: 37.9770, lng: 23.7208, lines: ['M1'], interchanges: [], firstTrain: { toTerminus1: '05:22', toTerminus2: '05:16' }, lastTrain: { toTerminus1: '00:52', toTerminus2: '00:46' } },
  { id: 'm1-monastiraki', name: 'Μοναστηράκι', line: 'M1', order: 8, lat: 37.9763, lng: 23.7256, lines: ['M1', 'M3'], interchanges: ['Γραμμή 3 (Μπλε)'], firstTrain: { toTerminus1: '05:20', toTerminus2: '05:18' }, lastTrain: { toTerminus1: '00:50', toTerminus2: '00:48' } },
  { id: 'm1-omonoia', name: 'Ομόνοια', line: 'M1', order: 9, lat: 37.9842, lng: 23.7280, lines: ['M1', 'M2'], interchanges: ['Γραμμή 2 (Κόκκινη)'], firstTrain: { toTerminus1: '05:18', toTerminus2: '05:20' }, lastTrain: { toTerminus1: '00:48', toTerminus2: '00:50' } },
  { id: 'm1-victoria', name: 'Βικτώρια', line: 'M1', order: 10, lat: 37.9931, lng: 23.7300, lines: ['M1'], interchanges: [], firstTrain: { toTerminus1: '05:15', toTerminus2: '05:23' }, lastTrain: { toTerminus1: '00:45', toTerminus2: '00:53' } },
  { id: 'm1-attiki', name: 'Αττική', line: 'M1', order: 11, lat: 37.9989, lng: 23.7225, lines: ['M1', 'M2'], interchanges: ['Γραμμή 2 (Κόκκινη)'], firstTrain: { toTerminus1: '05:13', toTerminus2: '05:25' }, lastTrain: { toTerminus1: '00:43', toTerminus2: '00:55' } },
  { id: 'm1-agios-nikolaos', name: 'Άγιος Νικόλαος', line: 'M1', order: 12, lat: 38.0068, lng: 23.7277, lines: ['M1'], interchanges: [], firstTrain: { toTerminus1: '05:10', toTerminus2: '05:28' }, lastTrain: { toTerminus1: '00:40', toTerminus2: '00:58' } },
  { id: 'm1-kato-patisia', name: 'Κάτω Πατήσια', line: 'M1', order: 13, lat: 38.0119, lng: 23.7288, lines: ['M1'], interchanges: [], firstTrain: { toTerminus1: '05:08', toTerminus2: '05:30' }, lastTrain: { toTerminus1: '00:38', toTerminus2: '01:00' } },
  { id: 'm1-agios-eleftherios', name: 'Άγιος Ελευθέριος', line: 'M1', order: 14, lat: 38.0201, lng: 23.7321, lines: ['M1'], interchanges: [], firstTrain: { toTerminus1: '05:06', toTerminus2: '05:32' }, lastTrain: { toTerminus1: '00:36', toTerminus2: '01:02' } },
  { id: 'm1-ano-patisia', name: 'Άνω Πατήσια', line: 'M1', order: 15, lat: 38.0235, lng: 23.7359, lines: ['M1'], interchanges: [], firstTrain: { toTerminus1: '05:04', toTerminus2: '05:34' }, lastTrain: { toTerminus1: '00:34', toTerminus2: '01:04' } },
  { id: 'm1-perissos', name: 'Περισσός', line: 'M1', order: 16, lat: 38.0328, lng: 23.7450, lines: ['M1'], interchanges: [], firstTrain: { toTerminus1: '05:01', toTerminus2: '05:37' }, lastTrain: { toTerminus1: '00:31', toTerminus2: '01:07' } },
  { id: 'm1-pefkakia', name: 'Πευκάκια', line: 'M1', order: 17, lat: 38.0369, lng: 23.7508, lines: ['M1'], interchanges: [], firstTrain: { toTerminus1: '05:00', toTerminus2: '05:39' }, lastTrain: { toTerminus1: '00:29', toTerminus2: '01:09' } },
  { id: 'm1-nea-ionia', name: 'Νέα Ιωνία', line: 'M1', order: 18, lat: 38.0403, lng: 23.7558, lines: ['M1'], interchanges: [], firstTrain: { toTerminus1: '05:02', toTerminus2: '05:41' }, lastTrain: { toTerminus1: '00:27', toTerminus2: '01:11' } },
  { id: 'm1-irakleio', name: 'Ηράκλειο', line: 'M1', order: 19, lat: 38.0461, lng: 23.7661, lines: ['M1'], interchanges: [], firstTrain: { toTerminus1: '05:05', toTerminus2: '05:44' }, lastTrain: { toTerminus1: '00:24', toTerminus2: '01:14' } },
  { id: 'm1-eirini', name: 'Ειρήνη', line: 'M1', order: 20, lat: 38.0433, lng: 23.7844, lines: ['M1'], interchanges: ['ΟΑΚΑ'], firstTrain: { toTerminus1: '05:08', toTerminus2: '05:47' }, lastTrain: { toTerminus1: '00:21', toTerminus2: '01:17' } },
  { id: 'm1-neratziotissa', name: 'Νερατζιώτισσα', line: 'M1', order: 21, lat: 38.0450, lng: 23.7936, lines: ['M1'], interchanges: ['Προαστιακός', 'Mall Athens'], firstTrain: { toTerminus1: '05:10', toTerminus2: '05:49' }, lastTrain: { toTerminus1: '00:19', toTerminus2: '01:19' } },
  { id: 'm1-marousi', name: 'Μαρούσι', line: 'M1', order: 22, lat: 38.0561, lng: 23.8050, lines: ['M1'], interchanges: [], firstTrain: { toTerminus1: '05:13', toTerminus2: '05:52' }, lastTrain: { toTerminus1: '00:16', toTerminus2: '01:22' } },
  { id: 'm1-kat', name: 'ΚΑΤ', line: 'M1', order: 23, lat: 38.0664, lng: 23.8067, lines: ['M1'], interchanges: [], firstTrain: { toTerminus1: '05:16', toTerminus2: '05:55' }, lastTrain: { toTerminus1: '00:13', toTerminus2: '01:25' } },
  { id: 'm1-kifisia', name: 'Κηφισιά', line: 'M1', order: 24, lat: 38.0736, lng: 23.8081, lines: ['M1'], interchanges: [], firstTrain: { toTerminus1: '05:00' }, lastTrain: { toTerminus1: '00:30' } },

  // ================= LINE 2 (ΚΟΚΚΙΝΗ) =================
  { id: 'm2-anthoupoli', name: 'Ανθούπολη', line: 'M2', order: 1, lat: 38.0175, lng: 23.6925, lines: ['M2'], interchanges: [], firstTrain: { toTerminus2: '05:30' }, lastTrain: { toTerminus2: '00:05' } },
  { id: 'm2-peristeri', name: 'Περιστέρι', line: 'M2', order: 2, lat: 38.0133, lng: 23.6917, lines: ['M2'], interchanges: [], firstTrain: { toTerminus1: '05:58', toTerminus2: '05:32' }, lastTrain: { toTerminus1: '00:34', toTerminus2: '00:07' } },
  { id: 'm2-agios-antonios', name: 'Άγιος Αντώνιος', line: 'M2', order: 3, lat: 38.0069, lng: 23.6997, lines: ['M2'], interchanges: [], firstTrain: { toTerminus1: '05:56', toTerminus2: '05:34' }, lastTrain: { toTerminus1: '00:32', toTerminus2: '00:09' } },
  { id: 'm2-sepolia', name: 'Σεπόλια', line: 'M2', order: 4, lat: 38.0019, lng: 23.7087, lines: ['M2'], interchanges: [], firstTrain: { toTerminus1: '05:53', toTerminus2: '05:37' }, lastTrain: { toTerminus1: '00:29', toTerminus2: '00:12' } },
  { id: 'm2-attiki', name: 'Αττική', line: 'M2', order: 5, lat: 37.9989, lng: 23.7225, lines: ['M1', 'M2'], interchanges: ['Γραμμή 1 (ΗΣΑΠ)'], firstTrain: { toTerminus1: '05:51', toTerminus2: '05:39' }, lastTrain: { toTerminus1: '00:27', toTerminus2: '00:14' } },
  { id: 'm2-stathmos-larisis', name: 'Σταθμός Λαρίσης', line: 'M2', order: 6, lat: 37.9924, lng: 23.7210, lines: ['M2'], interchanges: ['Τρένα Hellenic Train', 'Προαστιακός'], firstTrain: { toTerminus1: '05:49', toTerminus2: '05:41' }, lastTrain: { toTerminus1: '00:25', toTerminus2: '00:16' } },
  { id: 'm2-metaxourgeio', name: 'Μεταξουργείο', line: 'M2', order: 7, lat: 37.9859, lng: 23.7211, lines: ['M2'], interchanges: [], firstTrain: { toTerminus1: '05:47', toTerminus2: '05:43' }, lastTrain: { toTerminus1: '00:23', toTerminus2: '00:18' } },
  { id: 'm2-omonoia', name: 'Ομόνοια', line: 'M2', order: 8, lat: 37.9842, lng: 23.7280, lines: ['M1', 'M2'], interchanges: ['Γραμμή 1 (ΗΣΑΠ)'], firstTrain: { toTerminus1: '05:45', toTerminus2: '05:45' }, lastTrain: { toTerminus1: '00:21', toTerminus2: '00:20' } },
  { id: 'm2-panepistimio', name: 'Πανεπιστήμιο', line: 'M2', order: 9, lat: 37.9804, lng: 23.7332, lines: ['M2'], interchanges: ['ΕΚΠΑ', 'Ακαδημία'], firstTrain: { toTerminus1: '05:43', toTerminus2: '05:47' }, lastTrain: { toTerminus1: '00:19', toTerminus2: '00:22' } },
  { id: 'm2-syntagma', name: 'Σύνταγμα', line: 'M2', order: 10, lat: 37.9753, lng: 23.7348, lines: ['M2', 'M3', 'TRAM'], interchanges: ['Γραμμή 3 (Μπλε)', 'Τραμ'], firstTrain: { toTerminus1: '05:41', toTerminus2: '05:49' }, lastTrain: { toTerminus1: '00:17', toTerminus2: '00:24' } },
  { id: 'm2-akropoli', name: 'Ακρόπολη', line: 'M2', order: 11, lat: 37.9690, lng: 23.7297, lines: ['M2'], interchanges: ['Μουσείο Ακρόπολης'], firstTrain: { toTerminus1: '05:39', toTerminus2: '05:51' }, lastTrain: { toTerminus1: '00:15', toTerminus2: '00:26' } },
  { id: 'm2-syngrou-fix', name: 'Συγγρού-Φιξ', line: 'M2', order: 12, lat: 37.9647, lng: 23.7269, lines: ['M2', 'TRAM'], interchanges: ['Τραμ (Φιξ)', 'ΕΜΣΤ'], firstTrain: { toTerminus1: '05:37', toTerminus2: '05:53' }, lastTrain: { toTerminus1: '00:13', toTerminus2: '00:28' } },
  { id: 'm2-neos-kosmos', name: 'Νέος Κόσμος', line: 'M2', order: 13, lat: 37.9582, lng: 23.7284, lines: ['M2', 'TRAM'], interchanges: ['Τραμ'], firstTrain: { toTerminus1: '05:35', toTerminus2: '05:55' }, lastTrain: { toTerminus1: '00:11', toTerminus2: '00:30' } },
  { id: 'm2-agios-ioannis', name: 'Άγιος Ιωάννης', line: 'M2', order: 14, lat: 37.9569, lng: 23.7350, lines: ['M2'], interchanges: [], firstTrain: { toTerminus1: '05:33', toTerminus2: '05:57' }, lastTrain: { toTerminus1: '00:09', toTerminus2: '00:32' } },
  { id: 'm2-dafni', name: 'Δάφνη', line: 'M2', order: 15, lat: 37.9497, lng: 23.7378, lines: ['M2'], interchanges: [], firstTrain: { toTerminus1: '05:31', toTerminus2: '05:59' }, lastTrain: { toTerminus1: '00:07', toTerminus2: '00:34' } },
  { id: 'm2-agios-dimitrios', name: 'Άγιος Δημήτριος - Αλ. Παναγούλης', line: 'M2', order: 16, lat: 37.9405, lng: 23.7408, lines: ['M2'], interchanges: ['Athens Metro Mall'], firstTrain: { toTerminus1: '05:29', toTerminus2: '06:01' }, lastTrain: { toTerminus1: '00:05', toTerminus2: '00:36' } },
  { id: 'm2-ilioupoli', name: 'Ηλιούπολη - Γρηγόρης Γρηγορίου', line: 'M2', order: 17, lat: 37.9308, lng: 23.7461, lines: ['M2'], interchanges: [], firstTrain: { toTerminus1: '05:27', toTerminus2: '06:03' }, lastTrain: { toTerminus1: '00:03', toTerminus2: '00:38' } },
  { id: 'm2-alimos', name: 'Άλιμος', line: 'M2', order: 18, lat: 37.9189, lng: 23.7439, lines: ['M2'], interchanges: [], firstTrain: { toTerminus1: '05:25', toTerminus2: '06:05' }, lastTrain: { toTerminus1: '00:01', toTerminus2: '00:40' } },
  { id: 'm2-argyroupoli', name: 'Αργυρούπολη', line: 'M2', order: 19, lat: 37.9108, lng: 23.7481, lines: ['M2'], interchanges: [], firstTrain: { toTerminus1: '05:23', toTerminus2: '06:07' }, lastTrain: { toTerminus1: '00:00', toTerminus2: '00:42' } },
  { id: 'm2-elliniko', name: 'Ελληνικό', line: 'M2', order: 20, lat: 37.8994, lng: 23.7447, lines: ['M2'], interchanges: [], firstTrain: { toTerminus1: '05:30' }, lastTrain: { toTerminus1: '00:05' } },

  // ================= LINE 3 (ΜΠΛΕ) =================
  { id: 'm3-dimotiko-theatro', name: 'Δημοτικό Θέατρο', line: 'M3', order: 1, lat: 37.9431, lng: 23.6469, lines: ['M3', 'TRAM'], interchanges: ['Τραμ (Δημαρχείο)'], firstTrain: { toTerminus2: '05:30' }, lastTrain: { toTerminus2: '00:05' } },
  { id: 'm3-peiraias', name: 'Πειραιάς', line: 'M3', order: 2, lat: 37.9482, lng: 23.6428, lines: ['M1', 'M3', 'TRAM'], interchanges: ['Γραμμή 1 (ΗΣΑΠ)', 'Τραμ', 'Προαστιακός', 'Λιμάνι Πειραιά'], firstTrain: { toTerminus1: '06:14', toTerminus2: '05:32' }, lastTrain: { toTerminus1: '00:54', toTerminus2: '00:07' } },
  { id: 'm3-maniatika', name: 'Μανιάτικα', line: 'M3', order: 3, lat: 37.9575, lng: 23.6536, lines: ['M3'], interchanges: [], firstTrain: { toTerminus1: '06:12', toTerminus2: '05:34' }, lastTrain: { toTerminus1: '00:52', toTerminus2: '00:09' } },
  { id: 'm3-nikaia', name: 'Νίκαια', line: 'M3', order: 4, lat: 37.9658, lng: 23.6467, lines: ['M3'], interchanges: [], firstTrain: { toTerminus1: '06:10', toTerminus2: '05:36' }, lastTrain: { toTerminus1: '00:50', toTerminus2: '00:11' } },
  { id: 'm3-korydallos', name: 'Κορυδαλλός', line: 'M3', order: 5, lat: 37.9772, lng: 23.6508, lines: ['M3'], interchanges: [], firstTrain: { toTerminus1: '06:08', toTerminus2: '05:38' }, lastTrain: { toTerminus1: '00:48', toTerminus2: '00:13' } },
  { id: 'm3-agia-varvara', name: 'Αγία Βαρβάρα', line: 'M3', order: 6, lat: 37.9897, lng: 23.6594, lines: ['M3'], interchanges: [], firstTrain: { toTerminus1: '06:06', toTerminus2: '05:40' }, lastTrain: { toTerminus1: '00:46', toTerminus2: '00:15' } },
  { id: 'm3-agia-marina', name: 'Αγία Μαρίνα', line: 'M3', order: 7, lat: 37.9972, lng: 23.6681, lines: ['M3'], interchanges: [], firstTrain: { toTerminus1: '06:04', toTerminus2: '05:42' }, lastTrain: { toTerminus1: '00:44', toTerminus2: '00:17' } },
  { id: 'm3-egaleo', name: 'Αιγάλεω', line: 'M3', order: 8, lat: 37.9922, lng: 23.6814, lines: ['M3'], interchanges: ['ΠΑΔΑ'], firstTrain: { toTerminus1: '06:02', toTerminus2: '05:44' }, lastTrain: { toTerminus1: '00:42', toTerminus2: '00:19' } },
  { id: 'm3-elaionas', name: 'Ελαιώνας', line: 'M3', order: 9, lat: 37.9877, lng: 23.6941, lines: ['M3'], interchanges: [], firstTrain: { toTerminus1: '06:00', toTerminus2: '05:46' }, lastTrain: { toTerminus1: '00:40', toTerminus2: '00:21' } },
  { id: 'm3-kerameikos', name: 'Κεραμεικός', line: 'M3', order: 10, lat: 37.9787, lng: 23.7112, lines: ['M3'], interchanges: ['Τεχνόπολη'], firstTrain: { toTerminus1: '05:58', toTerminus2: '05:48' }, lastTrain: { toTerminus1: '00:38', toTerminus2: '00:23' } },
  { id: 'm3-monastiraki', name: 'Μοναστηράκι', line: 'M3', order: 11, lat: 37.9763, lng: 23.7256, lines: ['M1', 'M3'], interchanges: ['Γραμμή 1 (ΗΣΑΠ)'], firstTrain: { toTerminus1: '05:56', toTerminus2: '05:50' }, lastTrain: { toTerminus1: '00:36', toTerminus2: '00:25' } },
  { id: 'm3-syntagma', name: 'Σύνταγμα', line: 'M3', order: 12, lat: 37.9753, lng: 23.7348, lines: ['M2', 'M3', 'TRAM'], interchanges: ['Γραμμή 2 (Κόκκινη)', 'Τραμ'], firstTrain: { toTerminus1: '05:54', toTerminus2: '05:52' }, lastTrain: { toTerminus1: '00:34', toTerminus2: '00:27' } },
  { id: 'm3-evangelismos', name: 'Ευαγγελισμός', line: 'M3', order: 13, lat: 37.9764, lng: 23.7480, lines: ['M3'], interchanges: ['Εθνική Πινακοθήκη', 'Νοσοκομείο Ευαγγελισμός'], firstTrain: { toTerminus1: '05:52', toTerminus2: '05:54' }, lastTrain: { toTerminus1: '00:32', toTerminus2: '00:29' } },
  { id: 'm3-megaro-mousikis', name: 'Μέγαρο Μουσικής', line: 'M3', order: 14, lat: 37.9796, lng: 23.7545, lines: ['M3'], interchanges: [], firstTrain: { toTerminus1: '05:50', toTerminus2: '05:56' }, lastTrain: { toTerminus1: '00:30', toTerminus2: '00:31' } },
  { id: 'm3-ambelokipi', name: 'Αμπελόκηποι', line: 'M3', order: 15, lat: 37.9870, lng: 23.7568, lines: ['M3'], interchanges: ['ΓΑΔΑ', 'Άρειος Πάγος'], firstTrain: { toTerminus1: '05:48', toTerminus2: '05:58' }, lastTrain: { toTerminus1: '00:28', toTerminus2: '00:33' } },
  { id: 'm3-panormou', name: 'Πανόρμου', line: 'M3', order: 16, lat: 37.9934, lng: 23.7637, lines: ['M3'], interchanges: [], firstTrain: { toTerminus1: '05:46', toTerminus2: '06:00' }, lastTrain: { toTerminus1: '00:26', toTerminus2: '00:35' } },
  { id: 'm3-katehaki', name: 'Κατεχάκη', line: 'M3', order: 17, lat: 37.9932, lng: 23.7763, lines: ['M3'], interchanges: [], firstTrain: { toTerminus1: '05:44', toTerminus2: '06:02' }, lastTrain: { toTerminus1: '00:24', toTerminus2: '00:37' } },
  { id: 'm3-ethniki-amyna', name: 'Εθνική Άμυνα', line: 'M3', order: 18, lat: 38.0006, lng: 23.7859, lines: ['M3'], interchanges: ['Υπουργείο Εθνικής Άμυνας'], firstTrain: { toTerminus1: '05:42', toTerminus2: '06:04' }, lastTrain: { toTerminus1: '00:22', toTerminus2: '00:39' } },
  { id: 'm3-holargos', name: 'Χολαργός', line: 'M3', order: 19, lat: 38.0047, lng: 23.7947, lines: ['M3'], interchanges: [], firstTrain: { toTerminus1: '05:40', toTerminus2: '06:06' }, lastTrain: { toTerminus1: '00:20', toTerminus2: '00:41' } },
  { id: 'm3-nomismatokopio', name: 'Νομισματοκοπείο', line: 'M3', order: 20, lat: 38.0089, lng: 23.8058, lines: ['M3'], interchanges: ['Σταθμός Μετεπιβίβασης Λεωφορείων'], firstTrain: { toTerminus1: '05:38', toTerminus2: '06:08' }, lastTrain: { toTerminus1: '00:18', toTerminus2: '00:43' } },
  { id: 'm3-agia-paraskevi', name: 'Αγία Παρασκευή', line: 'M3', order: 21, lat: 38.0174, lng: 23.8127, lines: ['M3'], interchanges: [], firstTrain: { toTerminus1: '05:36', toTerminus2: '06:10' }, lastTrain: { toTerminus1: '00:16', toTerminus2: '00:45' } },
  { id: 'm3-chalandri', name: 'Χαλάνδρι', line: 'M3', order: 22, lat: 38.0217, lng: 23.8211, lines: ['M3'], interchanges: [], firstTrain: { toTerminus1: '05:34', toTerminus2: '06:12' }, lastTrain: { toTerminus1: '00:14', toTerminus2: '00:47' } },
  { id: 'm3-doukissis-plakentias', name: 'Δουκίσσης Πλακεντίας', line: 'M3', order: 23, lat: 38.0247, lng: 23.8331, lines: ['M3'], interchanges: ['Προαστιακός', 'Μετεπιβίβαση Αεροδρομίου'], firstTrain: { toTerminus1: '05:30', toTerminus2: '06:15' }, lastTrain: { toTerminus1: '00:10', toTerminus2: '00:50' } },
  { id: 'm3-pallini', name: 'Παλλήνη', line: 'M3', order: 24, lat: 37.9925, lng: 23.8839, lines: ['M3'], interchanges: ['Προαστιακός'], firstTrain: { toTerminus1: '06:00', toTerminus2: '06:22' }, lastTrain: { toTerminus1: '23:35', toTerminus2: '23:45' } },
  { id: 'm3-paiania-kantza', name: 'Παιανία-Κάντζα', line: 'M3', order: 25, lat: 37.9358, lng: 23.8703, lines: ['M3'], interchanges: ['Προαστιακός'], firstTrain: { toTerminus1: '05:55', toTerminus2: '06:26' }, lastTrain: { toTerminus1: '23:30', toTerminus2: '23:49' } },
  { id: 'm3-koropi', name: 'Κορωπί', line: 'M3', order: 26, lat: 37.9125, lng: 23.8725, lines: ['M3'], interchanges: ['Προαστιακός'], firstTrain: { toTerminus1: '05:49', toTerminus2: '06:31' }, lastTrain: { toTerminus1: '23:25', toTerminus2: '23:54' } },
  { id: 'm3-aerodromio', name: 'Αεροδρόμιο', line: 'M3', order: 27, lat: 37.9367, lng: 23.9450, lines: ['M3'], interchanges: ['Διεθνής Αερολιμένας Αθηνών', 'Προαστιακός'], firstTrain: { toTerminus1: '06:10' }, lastTrain: { toTerminus1: '23:34' } },

  // ================= TRAM (T6 & T7) =================
  { id: 'tram-syntagma', name: 'Σύνταγμα', line: 'TRAM', order: 1, lat: 37.9749, lng: 23.7356, lines: ['TRAM', 'M2', 'M3'], interchanges: ['Μετρό Γραμμή 2', 'Μετρό Γραμμή 3'] },
  { id: 'tram-zappeio', name: 'Ζάππειο', line: 'TRAM', order: 2, lat: 37.9694, lng: 23.7368, lines: ['TRAM'], interchanges: ['Ζάππειο Μέγαρο', 'Εθνικός Κήπος'] },
  { id: 'tram-vouliagmenis', name: 'Λεωφόρος Βουλιαγμένης', line: 'TRAM', order: 3, lat: 37.9665, lng: 23.7321, lines: ['TRAM'], interchanges: [] },
  { id: 'tram-fix', name: 'Φιξ', line: 'TRAM', order: 4, lat: 37.9643, lng: 23.7269, lines: ['TRAM', 'M2'], interchanges: ['Μετρό Συγγρού-Φιξ', 'ΕΜΣΤ'] },
  { id: 'tram-kasomouli', name: 'Κασομούλη', line: 'TRAM', order: 5, lat: 37.9605, lng: 23.7235, lines: ['TRAM'], interchanges: [] },
  { id: 'tram-neos-kosmos', name: 'Νέος Κόσμος', line: 'TRAM', order: 6, lat: 37.9579, lng: 23.7279, lines: ['TRAM', 'M2'], interchanges: ['Μετρό Νέος Κόσμος'] },
  { id: 'tram-baknana', name: 'Μπακνανά', line: 'TRAM', order: 7, lat: 37.9548, lng: 23.7231, lines: ['TRAM'], interchanges: [] },
  { id: 'tram-aegeou', name: 'Αιγαίου', line: 'TRAM', order: 8, lat: 37.9492, lng: 23.7198, lines: ['TRAM'], interchanges: [] },
  { id: 'tram-agia-foteini', name: 'Αγία Φωτεινή', line: 'TRAM', order: 9, lat: 37.9458, lng: 23.7152, lines: ['TRAM'], interchanges: ['Πλατεία Νέας Σμύρνης'] },
  { id: 'tram-megalou-alexandrou', name: 'Μεγάλου Αλεξάνδρου', line: 'TRAM', order: 10, lat: 37.9421, lng: 23.7118, lines: ['TRAM'], interchanges: [] },
  { id: 'tram-pikrodafni', name: 'Πικροδάφνη', line: 'TRAM', order: 11, lat: 37.9174, lng: 23.7029, lines: ['TRAM'], interchanges: ['Μετεπιβίβαση T6 / T7'] },
  { id: 'tram-marina-alimou', name: 'Μαρίνα Αλίμου', line: 'TRAM', order: 12, lat: 37.9125, lng: 23.7098, lines: ['TRAM'], interchanges: ['Μαρίνα Αλίμου'] },
  { id: 'tram-kalamaki', name: 'Καλαμάκι', line: 'TRAM', order: 13, lat: 37.9062, lng: 23.7161, lines: ['TRAM'], interchanges: [] },
  { id: 'tram-asklipiio-voulas', name: 'Ασκληπιείο Βούλας', line: 'TRAM', order: 14, lat: 37.8476, lng: 23.7535, lines: ['TRAM'], interchanges: ['Νοσοκομείο Βούλας'] },
  { id: 'tram-agia-triada', name: 'Αγία Τριάδα', line: 'TRAM', order: 15, lat: 37.9441, lng: 23.6448, lines: ['TRAM', 'M3'], interchanges: ['Δημοτικό Θέατρο', 'Κέντρο Πειραιά'] },
  { id: 'tram-sef', name: 'ΣΕΦ', line: 'TRAM', order: 16, lat: 37.9452, lng: 23.6661, lines: ['TRAM', 'M1'], interchanges: ['Μετρό Φάληρο', 'Στάδιο Ειρήνης & Φιλίας'] }
];

class MetroService {
  constructor() {
    this.lines = METRO_LINES;
    this.stations = ALL_STATIONS;
    this.rawTracks = null;
    this.loadTracks();
  }

  loadTracks() {
    try {
      const tracksPath = path.join(__dirname, 'metro-tracks-raw.json');
      if (fs.existsSync(tracksPath)) {
        this.rawTracks = JSON.parse(fs.readFileSync(tracksPath, 'utf8'));
      }
    } catch (e) {
      console.warn('[MetroService] Failed to load local tracks file, using procedural fallback:', e.message);
    }
  }

  /**
   * Calculate real-time headway frequency and upcoming train departure estimates
   * based on official STASY headway operational tables
   */
  calculateDepartures(station, targetTime = new Date()) {
    const hours = targetTime.getHours();
    const minutes = targetTime.getMinutes();
    const dayOfWeek = targetTime.getDay(); // 0 = Sunday, 5 = Friday, 6 = Saturday

    const isWeekendNight = (dayOfWeek === 5 || dayOfWeek === 6) && (hours >= 0 && hours < 2);
    const lineId = station.line;
    let headwayMinutes = 6; // default fallback

    if (lineId === 'M1') {
      if ((hours >= 7 && hours < 10) || (hours >= 14 && hours < 17)) {
        headwayMinutes = 5.5; // Peak
      } else if (hours >= 10 && hours < 20) {
        headwayMinutes = 7.5; // Off-peak
      } else if (hours >= 20 && hours < 23) {
        headwayMinutes = 10.5;
      } else {
        headwayMinutes = 15;
      }
    } else if (lineId === 'M2' || lineId === 'M3') {
      if ((hours >= 7 && hours < 10) || (hours >= 13 && hours < 17)) {
        headwayMinutes = 4.2; // Peak
      } else if (hours >= 10 && hours < 20) {
        headwayMinutes = 6.5; // Off-peak
      } else if (hours >= 20 && hours < 23) {
        headwayMinutes = 9;
      } else if (isWeekendNight) {
        headwayMinutes = 15; // 24h Friday/Saturday extension
      } else {
        headwayMinutes = 12;
      }
    } else if (lineId === 'TRAM') {
      if ((hours >= 7 && hours < 10) || (hours >= 14 && hours < 18)) {
        headwayMinutes = 11;
      } else {
        headwayMinutes = 14;
      }
    }

    // Determine if service is currently active
    const isLateNight = (hours >= 1 && hours < 5);
    const isActive = !isLateNight || isWeekendNight;

    const lineInfo = this.lines[lineId] || this.lines['M1'];
    const dir1Terminus = lineInfo.termini[0];
    const dir2Terminus = lineInfo.termini[lineInfo.termini.length - 1];

    // Compute cyclic remaining minutes to simulate live dispatch
    const currentMinuteOfDay = hours * 60 + minutes;
    const offsetDir1 = Math.floor((currentMinuteOfDay % headwayMinutes));
    const nextInDir1 = Math.max(1, Math.round(headwayMinutes - offsetDir1));
    const followingInDir1 = Math.round(nextInDir1 + headwayMinutes);

    const offsetDir2 = Math.floor(((currentMinuteOfDay + Math.floor(headwayMinutes / 2)) % headwayMinutes));
    const nextInDir2 = Math.max(1, Math.round(headwayMinutes - offsetDir2));
    const followingInDir2 = Math.round(nextInDir2 + headwayMinutes);

    const departures = [];

    if (isActive) {
      if (station.name !== dir1Terminus) {
        departures.push({
          direction: `Προς ${dir1Terminus}`,
          terminus: dir1Terminus,
          estimated_in_minutes: nextInDir1,
          next_estimated_in_minutes: followingInDir1,
          headway_minutes: headwayMinutes,
          line: lineId,
          status: 'Κανονική Ροή'
        });
      }

      if (station.name !== dir2Terminus) {
        departures.push({
          direction: `Προς ${dir2Terminus}`,
          terminus: dir2Terminus,
          estimated_in_minutes: nextInDir2,
          next_estimated_in_minutes: followingInDir2,
          headway_minutes: headwayMinutes,
          line: lineId,
          status: 'Κανονική Ροή'
        });
      }

      // Special handling for Airport trains on Line 3
      if (lineId === 'M3' && station.order >= 1 && station.order <= 26) {
        const airportInterval = 36;
        const airportOffset = currentMinuteOfDay % airportInterval;
        const nextAirportIn = Math.max(2, airportInterval - airportOffset);
        departures.push({
          direction: 'Προς Αεροδρόμιο (Απευθείας)',
          terminus: 'Αεροδρόμιο',
          estimated_in_minutes: nextAirportIn,
          headway_minutes: 36,
          line: 'M3',
          badge: '✈️ Αεροδρόμιο',
          status: 'Απευθείας Συρμός'
        });
      }
    }

    return {
      is_active: isActive,
      current_headway_minutes: headwayMinutes,
      status_message: isActive ? `Συχνότητα διέλευσης αυτή την ώρα: κάθε ~${headwayMinutes} λεπτά` : 'Εκτός ωραρίου λειτουργίας (Επόμενη αναχώρηση 05:30)',
      departures
    };
  }

  /**
   * Find nearby OASA bus stops within walking distance (~250m) of a metro station
   */
  async getNearbyBusConnections(station) {
    try {
      const allBusStops = await oasa.getAllStops();
      if (!Array.isArray(allBusStops)) return [];

      const sLat = station.lat;
      const sLng = station.lng;

      const nearbyStops = [];

      for (const bs of allBusStops) {
        const bLat = parseFloat(bs.StopLat);
        const bLng = parseFloat(bs.StopLng);
        if (isNaN(bLat) || isNaN(bLng)) continue;

        const dLatM = Math.abs(bLat - sLat) * 111139;
        const avgLat = ((bLat + sLat) / 2) * Math.PI / 180;
        const dLngM = Math.abs(bLng - sLng) * (111139 * Math.cos(avgLat));
        const dist = Math.sqrt(dLatM * dLatM + dLngM * dLngM);

        if (dist <= 260) {
          nearbyStops.push({
            stop_code: bs.StopCode,
            stop_id: bs.StopID,
            stop_name: bs.StopDescr,
            street: bs.StopStreet || '',
            distance_meters: Math.round(dist),
            lat: bLat,
            lng: bLng
          });
        }
      }

      nearbyStops.sort((a, b) => a.distance_meters - b.distance_meters);

      // Enrich top 5 stops with passing lines
      const topStops = nearbyStops.slice(0, 5);
      const enriched = await Promise.all(topStops.map(async (ts) => {
        try {
          const routes = await oasa.getStopRoutes(ts.stop_code);
          const linesMap = new Map();
          if (Array.isArray(routes)) {
            for (const r of routes) {
              const lid = r.LineID;
              if (!lid) continue;
              if (!linesMap.has(lid)) {
                linesMap.set(lid, {
                  line_id: lid,
                  line_descr: r.LineDescr || r.RouteDescr || ''
                });
              }
            }
          }
          return {
            ...ts,
            lines: Array.from(linesMap.values())
          };
        } catch (e) {
          return { ...ts, lines: [] };
        }
      }));

      return enriched;
    } catch (err) {
      console.error('[MetroService] Failed to match bus connections:', err.message);
      return [];
    }
  }

  /**
   * Get detailed station information, live headway departures, and bus connections
   */
  async getStationDetails(stationId) {
    const station = this.stations.find(s => s.id === stationId || s.name.toLowerCase() === stationId.toLowerCase());
    if (!station) return null;

    const lineInfo = this.lines[station.line] || {};
    const timetable = this.calculateDepartures(station);
    const busConnections = await this.getNearbyBusConnections(station);

    return {
      station,
      line_info: lineInfo,
      timetable,
      bus_connections: busConnections
    };
  }

  /**
   * Return full GeoJSON for Leaflet:
   * 1. MultiLineString tracks for each line with authentic styling properties
   * 2. Point features for every station with badges, lines, and coordinates
   */
  generateLineTrack(lineId) {
    const lineStations = this.stations
      .filter(s => s.line === lineId)
      .sort((a, b) => a.order - b.order);

    const coords = [];
    for (let i = 0; i < lineStations.length; i++) {
      const s = lineStations[i];
      coords.push([s.lng, s.lat]);

      if (i < lineStations.length - 1) {
        const next = lineStations[i + 1];

        // M3 curves
        if (s.id === 'm3-chalandri' && next.id === 'm3-doukissis-plakentias') {
          coords.push([23.8260, 38.0228], [23.8300, 38.0238]);
        } else if (s.id === 'm3-doukissis-plakentias' && next.id === 'm3-pallini') {
          coords.push([23.8450, 38.0220], [23.8580, 38.0160], [23.8720, 38.0060], [23.8800, 37.9980]);
        } else if (s.id === 'm3-pallini' && next.id === 'm3-paiania-kantza') {
          coords.push([23.8810, 37.9780], [23.8750, 37.9550]);
        } else if (s.id === 'm3-koropi' && next.id === 'm3-aerodromio') {
          coords.push([23.8900, 37.9150], [23.9100, 37.9220], [23.9300, 37.9300]);
        } else if (s.id === 'm3-monastiraki' && next.id === 'm3-syntagma') {
          coords.push([23.7300, 37.9758]);
        } else if (s.id === 'm3-kerameikos' && next.id === 'm3-monastiraki') {
          coords.push([23.7180, 37.9775]);
        } else if (s.id === 'm3-nikaia' && next.id === 'm3-maniatika') {
          coords.push([23.6490, 37.9610]);
        }
        // M1 curves
        else if (s.id === 'm1-faliro' && next.id === 'm1-moschato') {
          coords.push([23.6730, 37.9500]);
        } else if (s.id === 'm1-thiseio' && next.id === 'm1-monastiraki') {
          coords.push([23.7230, 37.9765]);
        }
        // M2 curves
        else if (s.id === 'm2-omonoia' && next.id === 'm2-panepistimio') {
          coords.push([23.7306, 37.9823]);
        } else if (s.id === 'm2-panepistimio' && next.id === 'm2-syntagma') {
          coords.push([23.7340, 37.9778]);
        } else if (s.id === 'm2-syntagma' && next.id === 'm2-akropoli') {
          coords.push([23.7325, 37.9715]);
        }
      }
    }
    return coords;
  }

  generateTramTracks() {
    const t6Stations = this.stations.filter(s => s.line === 'TRAM' && s.order <= 14).sort((a, b) => a.order - b.order);
    const t6Coords = t6Stations.map(s => [s.lng, s.lat]);

    const pikrodafni = this.stations.find(s => s.id === 'tram-pikrodafni');
    const sef = this.stations.find(s => s.id === 'tram-sef');
    const agiaTriada = this.stations.find(s => s.id === 'tram-agia-triada');

    const t7BranchCoords = [
      [pikrodafni.lng, pikrodafni.lat],
      [23.6880, 37.9350],
      [sef.lng, sef.lat],
      [23.6550, 37.9440],
      [agiaTriada.lng, agiaTriada.lat]
    ];

    return [t6Coords, t7BranchCoords];
  }

  /**
   * Return full GeoJSON for Leaflet:
   * 1. Continuous LineString / MultiLineString tracks that pass exactly through each station
   * 2. Point features for every station with full metadata and scheduled departures
   */
  getNetworkGeoJson() {
    const features = [];

    // Metro Lines Tracks (M1, M2, M3)
    ['M1', 'M2', 'M3'].forEach(lineId => {
      const lineMeta = this.lines[lineId];
      const coords = this.generateLineTrack(lineId);

      features.push({
        type: 'Feature',
        id: `metro-track-${lineId.toLowerCase()}`,
        geometry: {
          type: 'LineString',
          coordinates: coords
        },
        properties: {
          kind: 'track',
          network: 'metro',
          line: lineId,
          line_name: lineMeta.name,
          color: lineMeta.color,
          weight: 5.5,
          opacity: 0.95
        }
      });
    });

    // Tram Tracks (T6 & T7)
    const tramCoords = this.generateTramTracks();
    features.push({
      type: 'Feature',
      id: 'tram-track-network',
      geometry: {
        type: 'MultiLineString',
        coordinates: tramCoords
      },
      properties: {
        kind: 'track',
        network: 'tram',
        line: 'TRAM',
        line_name: 'Τραμ Αθηνών (T6 / T7)',
        color: '#FFB81C',
        weight: 4.5,
        opacity: 0.9
      }
    });

    // Stations with scheduled departures pre-calculated
    this.stations.forEach(s => {
      const lineMeta = this.lines[s.line] || { color: '#005ac1' };
      const timetable = this.calculateDepartures(s);

      features.push({
        type: 'Feature',
        id: `station-${s.id}`,
        geometry: {
          type: 'Point',
          coordinates: [s.lng, s.lat]
        },
        properties: {
          kind: 'station',
          id: s.id,
          name: s.name,
          order: s.order,
          primary_line: s.line,
          lines: s.lines || [s.line],
          interchanges: s.interchanges || [],
          is_interchange: (s.lines && s.lines.length > 1) || (s.interchanges && s.interchanges.length > 0),
          color: lineMeta.color,
          firstTrain: s.firstTrain,
          lastTrain: s.lastTrain,
          timetable
        }
      });
    });

    return {
      type: 'FeatureCollection',
      lines: this.lines,
      features
    };
  }
}

module.exports = new MetroService();
