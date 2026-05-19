import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config';
import { authRouter } from './routes/auth';
import { schoolsRouter } from './routes/schools';
import { usersRouter } from './routes/users';
import { accountsRouter } from './routes/accounts';
import { costCentersRouter } from './routes/costCenters';
import { bookingsRouter } from './routes/bookings';
import { dailyClosingRouter } from './routes/dailyClosing';
import { datevExportRouter } from './routes/datevExport';
import { adminKassenStatusRouter } from './routes/adminKassenStatus';
import { belegartenRouter } from './routes/belegarten';
import { receiptsRouter } from './routes/receipts';
import { dmsMappingRouter } from './routes/dmsMapping';
import { dmsExportRouter } from './routes/dmsExport';
import { backfillKontonr2Mapping } from './services/dmsMappingService';

const app = express();

app.use(helmet());
app.use(cors({
  origin: config.nodeEnv === 'production'
    ? false // In production, nginx handles same-origin; no CORS needed
    : 'http://localhost:5173', // Vite dev server
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

app.use('/api/auth', authRouter);
app.use('/api/schools', schoolsRouter);
app.use('/api/users', usersRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/cost-centers', costCentersRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api/daily-closing', dailyClosingRouter);
app.use('/api/datev-export', datevExportRouter);
app.use('/api/admin/kassenstatus', adminKassenStatusRouter);
app.use('/api/belegarten', belegartenRouter);
app.use('/api/receipts', receiptsRouter);
app.use('/api/admin/dms-mapping', dmsMappingRouter);
app.use('/api/bookings/dms-export', dmsExportRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

async function start(): Promise<void> {
  // Backfill VOR listen() — sonst sehen die ersten Requests nach einem Deploy
  // ein DMS-Mapping ohne Kontonr2 (Race auf den ersten paar hundert ms).
  try {
    await backfillKontonr2Mapping();
  } catch (err) {
    console.error('[dmsMapping] Backfill Kontonr2 fehlgeschlagen:', err);
  }
  app.listen(config.port, () => {
    console.log(`Kassenbuch Backend running on port ${config.port}`);
  });
}

start().catch(err => {
  console.error('FATAL: Backend-Start fehlgeschlagen:', err);
  process.exit(1);
});
