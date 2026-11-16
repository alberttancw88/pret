/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  modularizeImports: {
    '@mui/icons-material': {
      transform: '@mui/icons-material/{{member}}',
    },
  },
  experimental: {
    serverActions: {
      // Receipts, MCs and documents are uploaded via signed Storage URLs (ADR-0007);
      // Server Action bodies stay small.
      bodySizeLimit: '2mb',
    },
  },
};

export default nextConfig;
