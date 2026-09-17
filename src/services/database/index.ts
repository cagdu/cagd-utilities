/**
 * Database katmanı. `database` varsayılan yöneticidir (Prisma tabanlı),
 * ham SQL gerektiğinde alttaki servisler doğrudan kullanılabilir.
 */
import { database } from "./Database.Manager";

export { database, DatabaseManager } from "./Database.Manager";
export { BaseService } from "./Base.Service";
export { default as Postgres_Service } from "./PostgreSQL.Service";
export { default as MSSQL_Service } from "./MsSQL.Service";

export type { DatabaseInitOptions, DatabaseProvider, PrismaClientConstructor } from "./Database.Manager";
export type { IDatabaseService } from "./Base.Service";

export default database;
