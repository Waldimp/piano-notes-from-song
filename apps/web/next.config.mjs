/** @type {import('next').NextConfig} */
const nextConfig = {
  // El paquete de contratos se consume como TS fuente desde el workspace.
  transpilePackages: ["@piano/contracts"],
};

export default nextConfig;
