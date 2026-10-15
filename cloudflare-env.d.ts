declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    DRIVER_ALLOWED_EMAILS?: string;
  }
}
