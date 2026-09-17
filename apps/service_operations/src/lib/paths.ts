import path from 'path';

export const ROOT_DIR = process.cwd();
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');
export const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
