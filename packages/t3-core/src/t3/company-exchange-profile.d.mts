export const COMPANY_PRODUCT_SERVICES:readonly string[];
export const COMPANY_PACKAGE_OPERATIONS:readonly string[];
export function companyExchangeServiceId(productServiceId:unknown):string|null;
export function originalCompanyExchangePassport(productPassport:{service_id:string;service_version:string}):Record<string,unknown>;
