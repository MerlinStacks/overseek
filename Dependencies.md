# Overseek V2 - Dependencies Reference

> Last updated: 2026-01-10 (Reviewed for 2026)

---

## Client-Side Dependencies

### Core Framework
| Package | Version | Purpose |
|---------|---------|---------|
| `react` | ^19.2.0 | Core UI library |
| `react-dom` | ^19.2.0 | React DOM rendering |
| `react-router-dom` | ^7.11.0 | Client-side routing |

### Rich Text Editors
| Package | Version | Purpose |
|---------|---------|---------|
| `@lexical/react` | ^0.39.0 | Unified rich text editor (migrated from Quill) |
| `react-email-editor` | ^1.7.11 | Unlayer-based email designer |

### Data Visualization & UI
| Package | Version | Purpose |
|---------|---------|---------|
| `echarts` | ^6.0.0 | Charts library (Apache ECharts) |
| `echarts-for-react` | ^3.0.5 | React wrapper for ECharts |
| `react-grid-layout` | ^2.2.2 | Dashboard grid system |
| `@xyflow/react` | ^12.10.0 | Flow builder (node-based diagrams) |
| `lucide-react` | ^0.562.0 | Icon library |

### Utilities
| Package | Version | Purpose |
|---------|---------|---------|
| `axios` | ^1.13.2 | HTTP client |
| `date-fns` | ^4.1.0 | Date utilities |
| `clsx` | ^2.1.1 | Classname utility |
| `tailwind-merge` | ^3.4.0 | Tailwind class merging |
| `dompurify` | ^3.3.1 | HTML sanitization |
| `dexie` | ^4.2.1 | IndexedDB wrapper (client caching) |
| `cmdk` | ^1.1.1 | Command palette |

### Document Generation
| Package | Version | Purpose |
|---------|---------|---------|
| `jspdf` | ^4.0.0 | PDF generation |
| `jspdf-autotable` | ^5.0.2 | PDF tables |
| `react-markdown` | ^10.1.0 | Markdown rendering |
| `remark-gfm` | ^4.0.1 | GitHub-flavored markdown |

### Real-time
| Package | Version | Purpose |
|---------|---------|---------|
| `socket.io-client` | ^4.8.3 | WebSocket client |

---

## Server-Side Dependencies

### Core Framework
| Package | Version | Purpose |
|---------|---------|---------|
| `fastify` | ^5.6.2 | Web server framework (100% migrated from Express) |
| `@fastify/cors` | ^11.2.0 | CORS middleware |
| `@fastify/helmet` | ^13.0.2 | Security headers |
| `@fastify/rate-limit` | ^10.3.0 | Rate limiting |
| `@fastify/compress` | ^8.3.1 | Response compression (Brotli/gzip) |
| `@fastify/multipart` | ^9.3.0 | File uploads |
| `@fastify/static` | ^9.0.0 | Static file serving |

### Database & ORM
| Package | Version | Purpose |
|---------|---------|---------|
| `prisma` | ^7.2.0 | ORM/schema management |
| `@prisma/client` | ^7.2.0 | Database client |
| `@prisma/adapter-pg` | ^7.2.0 | PostgreSQL adapter |
| `pg` | ^8.11.3 | PostgreSQL driver |
| `@elastic/elasticsearch` | ^9.2.0 | Elasticsearch client |

### Queue & Caching
| Package | Version | Purpose |
|---------|---------|---------|
| `bullmq` | ^5.1.0 | Job queue |
| `@bull-board/api` | ^6.16.2 | Queue dashboard API |
| `@bull-board/fastify` | ^6.16.2 | Queue dashboard UI (Fastify adapter) |
| `ioredis` | ^5.3.2 | Redis client |

### Authentication & Security
| Package | Version | Purpose |
|---------|---------|---------|
| `argon2` | ^0.44.0 | Argon2id password hashing (OWASP 2025+ recommended) |
| `jsonwebtoken` | ^9.0.3 | JWT tokens |
| `otplib` | ^12.0.1 | 2FA/OTP support |
| `qrcode` | ^1.5.4 | QR code generation |

### Email & Notifications
| Package | Version | Purpose |
|---------|---------|---------|
| `nodemailer` | ^7.0.12 | Email sending |
| `imapflow` | ^1.2.4 | IMAP email receiving |
| `web-push` | ^3.6.7 | Push notifications |

### Integrations
| Package | Version | Purpose |
|---------|---------|---------|
| `@woocommerce/woocommerce-rest-api` | ^1.0.2 | WooCommerce API |
| `google-ads-api` | ^22.0.0 | Google Ads integration |

### Utilities
| Package | Version | Purpose |
|---------|---------|---------|
| `zod` | ^4.3.5 | Schema validation |
| `pino` | ^10.1.1 | Logging (native Fastify integration) |
| `marked` | ^17.0.1 | Markdown parsing |
| `ua-parser-js` | ^2.0.7 | User agent parsing |
| `maxmind` | ^5.0.3 | IP geolocation (GeoLite2/GeoIP2 MMDB) |
| `dotenv` | ^17.2.3 | Environment variables |
| `socket.io` | ^4.8.3 | WebSocket server |

---

## Build Tools
| Package | Location | Version | Purpose |
|---------|----------|---------|----------|
| `vite` | Client | ^7.3.1 | Build tool |
| `typescript` | Both | ^5.8.3 | Type checking |
| `tailwindcss` | Client | ^4.1.18 | CSS framework (v4 with CSS-first config) |
| `@tailwindcss/postcss` | Client | ^4.1.18 | PostCSS plugin for TailwindCSS 4 |
| `eslint` | Client | ^9.39.0 | Linting (flat config) |
| `typescript-eslint` | Client | ^8.32.0 | TypeScript ESLint integration |
| `nodemon` | Server | | Development auto-reload |
| `ts-node` | Server | | TypeScript execution |
| `concurrently` | Root | | Run multiple scripts |

---

## Completed Migrations (Jan 2026)

| Migration | From | To | Status |
|-----------|------|-----|--------|
| Charting | Recharts | Apache ECharts | ✅ Complete |
| Rich Text | ReactQuill | Lexical | ✅ Complete |
| Web Framework | Express 5.x | Fastify 5 | ✅ Complete |
| IMAP | imap-simple | ImapFlow | ✅ Complete |
| GeoIP | geoip-lite | maxmind | ✅ Complete |
| Logging | Winston ^3.x | Pino ^9.x | ✅ Complete |
| Password Hashing | bcryptjs | argon2 (Argon2id) | ✅ Complete |
| React Core | React ^18.2.0 | React ^19.2.0 | ✅ Complete |
| HTTP Client (Server) | axios | Native fetch | ✅ Complete |
| Lodash (Client) | lodash | Native JS utilities | ✅ Complete |
| File Uploads | multer | @fastify/multipart | ✅ Complete |
| ESLint | v8 + typescript-eslint v6 | ESLint 9 + typescript-eslint 8 | ✅ Complete |
| TailwindCSS | v3.4 | v4.1 (CSS-first config) | ✅ Complete |

---

## Planned Upgrades (2026)

### 🔴 High Priority
| Current | Target | Reason |
|---------|--------|--------|
| _(none)_ | | |


### 🟡 Medium Priority
| Current | Target | Reason |
|---------|--------|--------|
| _(completed items moved above)_ | | |

### 🔵 Future Considerations
| Current | Target | Reason |
|---------|--------|--------|
| `ioredis` ^5.3.2 | `redis` ^5.x | Official Redis client with RESP3, client-side caching (blocked by BullMQ dependency) |

