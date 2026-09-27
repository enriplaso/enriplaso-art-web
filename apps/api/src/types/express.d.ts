declare global {
  namespace Express {
    interface Request {
      admin?: { sub: string; email: string };
    }
  }
}

export {};
