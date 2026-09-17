export { default as Axios_Service, Axios_Agent } from "./Axios.Service";
export { default as Redis_Service } from "./Redis.Service";
export { default as Mail_Service } from "./Mail.Service";

export type { CreateInstance, ErrorDetails_Code, Intercepter_Error } from "./Axios.Service";

import * as database from "./database";
import * as web from "./web";

export { database, web };