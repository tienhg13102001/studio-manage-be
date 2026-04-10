import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import connectDB from './config/db';

import authRoutes from './routes/auth';
import customerRoutes from './routes/customers';
import scheduleRoutes from './routes/schedules';
import transactionRoutes from './routes/transactions';
import categoryRoutes from './routes/categories';
import userRoutes from './routes/users';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/users', userRoutes);

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Internal server error' });
});

const PORT = Number(process.env.PORT) || 5000;

connectDB().then(() => {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});

export default app;
