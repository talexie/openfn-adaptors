import { enableMockClient } from '@openfn/language-common/util';

const apiPath = 'baseR4'; // Default FHIR Specification - R4
const baseUrl = 'https://hapi.fhir.org'; // default testing FHIR server

export const fileOrigin = 'https://files.example.net'; //absolute testing server

// This creates a mock client which acts like a fake server.
// It enables pattern-matching on the request object and custom responses
// For the full mock API see
// https://undici.nodejs.org/#/docs/api/MockPool?id=mockpoolinterceptoptions


export const testServer = enableMockClient(baseUrl);
export const testFileServer = enableMockClient(fileOrigin);

export const requestConfig = {
  apiPath,
  baseUrl,
}