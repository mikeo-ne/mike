/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep native / node-only drivers out of the client bundle and treat them
  // as external in the Node.js server runtime.
  experimental: {
    serverComponentsExternalPackages: ['@electric-sql/pglite', 'postgres'],
  },
};

export default nextConfig;
