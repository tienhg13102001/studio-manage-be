declare namespace Express {
  interface Request {
    user?: import('../models/User').IUser & { roles: import('../models/User').UserRole[] };
  }
}
