/** @type {import('next').NextConfig} */
const nextConfig = {
  // SPEED-ONLY V6: emit Next.js standalone server so normal Servicing starts
  // do not traverse/load the full application node_modules tree. UI/output is unchanged.
  output: 'standalone',
  poweredByHeader: false,
  typescript: {
    // Release startup builds stay fast; use `npm run check` for developer type checks.
    ignoreBuildErrors: true
  },
  webpack(config) {
    // On some Windows systems the persistent webpack pack cache can be left half-written
    // and Next then fails later while reading build manifests. Repeat app starts already
    // skip `next build`, so disabling this cache is safer and does not hurt normal startup.
    config.cache = false;
    return config;
  }
};

export default nextConfig;
