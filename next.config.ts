import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Libera acesso ao servidor de dev pelo IP da rede local (ex: testando
  // pelo celular/outro PC na mesma Wi-Fi) — sem isso o Next bloqueia o JS
  // por segurança e a página carrega "morta" (sem interatividade).
  allowedDevOrigins: ["192.168.8.72"],
};

export default nextConfig;
