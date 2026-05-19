const nodeEnv = process.env.NODE_ENV || 'development';

if (nodeEnv === 'production' && !process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable must be set in production');
  process.exit(1);
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
  jwtExpiresIn: 28800, // 8 hours in seconds
  nodeEnv,
  uploadDir: process.env.UPLOAD_DIR || '/data/uploads',
  maxReceiptSizeMb: parseInt(process.env.MAX_RECEIPT_SIZE_MB || '10', 10),
  maxReceiptFilesPerUpload: parseInt(process.env.MAX_RECEIPT_FILES_PER_UPLOAD || '10', 10),
};
