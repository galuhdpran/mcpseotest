# Cara Connect ke SEO MCP (GSC + GA4)

Server: `https://mcpseotest.revincolabs.com/mcp`

Kamu connect lewat **browser claude.ai** memakai OAuth. Kamu tidak perlu menempel
token; cukup ketik **password tim** (minta ke admin) sekali di layar consent.

> Metode lama (menempel `Authorization: Bearer <token>` lewat Claude Code CLI /
> Desktop) **sudah dinonaktifkan** — pakai cara di bawah.

---

## Sambungkan lewat browser claude.ai

1. Buka menu Connectors:
   - **Team/Enterprise:** Admin settings → **Connectors** → **Add custom connector**
     (harus Owner; member lalu klik **Connect**).
   - **Free/Pro/Max:** Settings → **Connectors** → **Add custom connector**.
2. **URL:** `https://mcpseotest.revincolabs.com/mcp`
3. Buka **Pengaturan lanjutan** dan **biarkan OAuth Client ID & Secret KOSONG**
   (Claude mendaftar sendiri otomatis). Klik **Tambahkan**.
4. Klik **Connect**. Akan terbuka **layar consent milik server** bertuliskan
   _"Sambungkan ke SEO MCP"_.
5. Masukkan **password tim** (dari admin), klik **Setujui & sambungkan**.
   Kamu akan diarahkan balik ke claude.ai dalam keadaan tersambung.
6. Aktifkan di chat lewat tombol **"+"** → Connectors.

---

## Cara pakai (contoh prompt)

Setelah connect, tanya Claude natural language:

- "List our Search Console sites."
- "Untuk `sc-domain:revincolabs.com`, top 20 query berdasarkan clicks 28 hari terakhir."
- "GA4: active users & sessions per country, 7 hari terakhir, property 123456789."
- "Berapa realtime active users sekarang di property 123456789?"
- "List GA4 properties yang tersedia."

Tools yang tersedia:
`gsc_list_sites`, `gsc_search_analytics`, `ga4_list_properties`,
`ga4_run_report`, `ga4_realtime_report`, `ga4_get_metadata`.

---

## Troubleshooting

| Masalah | Solusi |
|--------|--------|
| "Add connector" error "tidak dapat mendaftar" | OAuth belum aktif di server. Hubungi admin (set `MCP_PUBLIC_URL` + `MCP_OAUTH_JWT_SECRET`). |
| OAuth Client ID/Secret diminta wajib | Jangan diisi — biarkan kosong, klik Tambahkan. |
| Layar consent bilang "password salah" | Pakai password tim dari admin (`MCP_OAUTH_PASSWORD`). |
| Data kosong / error permission | Akun Google pusat belum punya akses ke properti GSC/GA4 itu. Hubungi admin. |
| CLI/Desktop pakai header token gagal | Memang sudah dinonaktifkan — connect lewat browser (cara di atas). |
