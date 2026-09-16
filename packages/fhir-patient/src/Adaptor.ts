import { 
  expandReferences,
  throwError 
} from '@openfn/language-common/util';
import { 
  absoluteRequest,
  ExportFile,
  ExportManifest,
  ManifestResponse,
  parseNdJson,
  prepareNextState,
  RequestOptions,
  sleep,
  toIsoFormat,
  toManifest,
  request as utilRequest 
} from './Utils.js';
import { DEFAULT_POLL_INTERVAL, DEFAULT_POLL_TIMEOUT, NDJSON } from './Constants.js';

/**
 * State object
 * @typedef {Object} HttpState
 * @property data - the parsed response body
 * @property response - the response from the HTTP server, including headers, statusCode, body, etc
 * @property references - an array of all previous data objects used in the Job
 **/

/**
 * Options provided to the HTTP request
 * @typedef {Object} RequestOptions
 * @public
 * @property {object|string} body - body data to append to the request. JSON will be converted to a string (but a content-type header will not be attached to the request).
 * @property {object} errors - Map of errorCodes -> error messages, ie, `{ 404: 'Resource not found;' }`. Pass `false` to suppress errors for this code.
 * @property {object} form - Pass a JSON object to be serialised into a multipart HTML form (as FormData) in the body.
 * @property {object} query - An object of query parameters to be encoded into the URL.
 * @property {object} headers - An object of headers to append to the request.
 * @property {string} parseAs - Parse the response body as json, text or stream. By default will use the response headers.
 * @property {number} timeout - Request timeout in ms. Default: 300 seconds.
 * @property {object} tls - TLS/SSL authentication options. See https://nodejs.org/api/tls.html#tlscreatesecurecontextoptions
 */

/**
 * @interface PollOptions - FHIR bulk export polling options
 */
export interface PollOptions extends RequestOptions{
  /** Milliseconds between status polls when the server sends no `Retry-After`. Default 5000. */
  pollInterval?: number;
  /** Give up waiting after this many milliseconds. Default 1800000 (30 minutes). */
  pollTimeout?: number;
  /** Only download files of these resource types. Default: all of them. */
  types?: string[];
  /** Stop after this many resources. Everything downloaded is held in state, so cap large exports. */
  max?: number;
  /** Also download the server's error files into `state.issues`. Default true. */
  includeErrors?: boolean;
}

/**
 * @interface ExportOptions - FHIR bulk export parameters
 * @link https://build.fhir.org/ig/HL7/bulk-data/en/export.html#parameters
 */
export interface ExportOptions {
  /** Only resources changed at or after this instant (FHIR `_since`). */
  since?: string | Date;
  /** Resource types to include (FHIR `_type`), e.g. `['Patient', 'Immunization']`. */
  types?: string[];
  /** Only these elements (FHIR `_elements`), e.g. `['Patient.id', 'Patient.name']`. */
  elements?: string[];
  /** Search expressions narrowing a type (FHIR `_typeFilter`), e.g. `['Patient?gender=female']`. */
  typeFilter?: string[];
  /** Defaults to `application/fhir+ndjson`. */
  outputFormat?: string;
};


/**
 * Download FHIR resource request e.g Patient
 * @example <caption> Download FHIR resource from FHIR Server </caption>
 * downloadResource("Patient");
 * @function
 * @public
 * @param {string} path - Path to resource, defaults to Patient
 * @param {RequestOptions} options - Optional request options
 * @returns {Operation}
 * @state {HttpState}
 * @link https://build.fhir.org/ig/HL7/bulk-data/en/export.html
 */
export const downloadResource = (
  path: string = 'Patient', 
  params: ExportOptions = {},
  options: PollOptions = {}
) => {
  return async (state: any) => {
    const [resolvedPath, resolvedOptions] =
      expandReferences(state, path, options);

    const statusUrl = await kickOffRequest(resolvedPath, state, params, resolvedOptions);
    state.statusUrl = statusUrl;
    const { manifest, response } = await pollRequest(state, statusUrl, resolvedOptions);
    const { resources, issues } = await collectRequest(state, manifest, resolvedOptions);
    const nextState = prepareNextState(state, response);
    
    nextState.manifest = manifest;
    nextState.resources = resources;
    if (issues.length) nextState.issues = issues;

    return nextState;
  };
}
/**
 * Kick-off request for FHIR Asynchronous Bulk Export
 * @private
 * @function
 * @param {string} path 
 * @param {any} state 
 * @param params 
 * @param options 
 * @returns Promise<string>
 * @link https://build.fhir.org/ig/HL7/bulk-data/en/async.html
 */

export const kickOffRequest = async (
  path: string = 'Patient', 
  state: any,
  params: Record<string,any> = {},
  options: ExportOptions & RequestOptions = {}
): Promise<string> => {
    const { headers = {}, query ={}, ...rest } = options;
    const { since, types, elements, typeFilter, outputFormat = NDJSON } = params;
    const modifiedOptions = { 
      ...rest,
      query:{
        _outputFormat: outputFormat,         
        ...(since ? { _since: toIsoFormat(since) } : {}),
        ...(types?.length ? { _type: types.join(',') } : { _type: 'Patient' }),
        ...(elements?.length ? { _elements: elements.join(',') } : {}),
        ...(typeFilter?.length ? { _typeFilter: typeFilter } : {}),
        ...query
      },
      headers:{
        Accept: 'application/fhir+json',
        Prefer: 'respond-async',
        ...headers,
      }
    }
    
    const kickOffResponse =  await utilRequest('GET', `${path}/$export`, state.configuration , modifiedOptions);
   
    const statusUrl = kickOffResponse.headers?.['content-location'];
    if(!statusUrl){
      throwError('NO_CONTENT_LOCATION',{
        description: "Content location not found",
        statusCode: kickOffResponse.statusCode,
        statusMessage: kickOffResponse.statusMessage,
        url: kickOffResponse.url,
        fix: 'Check if the FHIR server supports bulk export $xport'

      })
    }
    return statusUrl!;
}

/**
 * Poll the FHIR bulk export status URL until the server returns a manifest
 * @param state 
 * @param statusUrl 
 * @param options 
 * @returns 
 */
export const pollRequest = async (
  state: any, 
  statusUrl: string, 
  options: PollOptions = {}
): Promise<ManifestResponse> => {
  const { 
    pollInterval = DEFAULT_POLL_INTERVAL, 
    pollTimeout = DEFAULT_POLL_TIMEOUT 
  } = options;
  const startedAt = Date.now();

   for (;;) {
    const response = await absoluteRequest('GET', statusUrl, state.configuration, {
      headers: { Accept: 'application/fhir+json' },
      errors: { 202: false },
    });
    
 
    if (response.statusCode !== 202) return toManifest(response, statusUrl);
 
    const elapsed = Date.now() - startedAt;
 
    if (elapsed > pollTimeout) {
      throwError('EXPORT_TIMEOUT', {
        description: `The export was still running after ${Math.round(elapsed / 1000)}s`,
        fix: `The job is still running on the FHIR server. Collect it later with collectExport('${statusUrl}')`,
        statusUrl,
      });
    }
 
    const retryAfter = Number(response.headers?.['retry-after']);
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : pollInterval);
  }
}

/**
 * Download and parse the FHIR NDJSON files listed in the manifest
 * @param state 
 * @param manifest 
 * @param options 
 * @returns 
 */
export const collectRequest = async (
  state: any, 
  manifest: ExportManifest, 
  options: PollOptions = {}
) => {
  const { types, max = Infinity, includeErrors = true } = options;
 
  const resources: any[] = [];
  for (const file of manifest.output) {
    if (types && !types.includes(file.type)) continue;
    if (resources.length >= max) break;
 
    for await (const resource of streamNdJsonFile(state, file, manifest, options)) {
      resources.push(resource);
      if (resources.length >= max) break;
    }
  }
 
  const issues: any[] = [];
  if (includeErrors) {
    for (const file of manifest.error) {
      for await (const issue of streamNdJsonFile(state, file, manifest, options)) issues.push(issue);
    }
    if (issues.length){
      throwError('NO_EXPORT_REPORTED',{
        description: "FHIR server reported issues during bulk export",
        fix: 'Check if the FHIR server supports bulk export $xport'
      })
    }
  }
 
  return { resources, issues };
}
/**
 * Stream one FHIR NDJSON file, yielding a resource per line.
 * @private
 * @function
 * @param {any} state 
 * @param {ExportFile} file 
 * @param {ExportManifest} manifest 
 * @param {RequestOptions} options 
 */
export const streamNdJsonFile = async function* (
  state: any, 
  file: ExportFile, 
  manifest: ExportManifest, 
  options: RequestOptions
) {
   const response = await absoluteRequest('GET', file.url, state.configuration, {
    ...options,
    headers: { Accept: NDJSON, ...options.headers },
    parseAs: 'stream',
    auth: manifest.requiresAccessToken === true,
  });
 
  yield* parseNdJson(response.body, file.url);
}

/**
 * Make a GET request
 * @example <caption> Make a GET request to FHIR Server </caption>
 * get("Patient");
 * @function
 * @public
 * @param {string} path - Path to resource
 * @param {RequestOptions} options - Optional request options
 * @returns {Operation}
 * @state {HttpState}
 */
export const get = (path: string , options: RequestOptions = {}) => {
  return request('GET', path, null, options);
}

/**
 * Make a POST request
 * @example <caption> Make a POST request to FHIR Server </caption>
 * post("Patient", { "name": "Bukayo" });
 * @function
 * @public
 * @param {string} path - Path to resource
 * @param {object} body - Object which will be attached to the POST body
 * @param {RequestOptions} options - Optional request options
 * @returns {Operation}
 * @state {HttpState}
 */
export const post = (path: string , body: Record<string, any>, options: RequestOptions = {}) => {
  return request('POST', path, body, options);
}

/**
 * Make a general HTTP request
 * @example <caption> Make a generic GET request to FHIR Server </caption>
 * request(
 *  "GET", "Patient", null }
 * );
 * @function
 * @public
 * @param {string} method - HTTP method to use
 * @param {string} path - Path to resource
 * @param {object} body - Object which will be attached to the POST body
 * @param {RequestOptions} options - Optional request options
 * @returns {Operation}
 * @state {HttpState}
 */
export const request = (
  method: string, 
  path: string,
  body: Record<string,any> | null, 
  options: RequestOptions = {}
) => {
  return async (state: any) => {
    const [resolvedMethod, resolvedPath, resolvedBody, resolvedoptions] =
      expandReferences(state, method, path, body, options);

    const response = await utilRequest(
      resolvedMethod,
      resolvedPath,
      state.configuration,
      {
        body: resolvedBody,
        ...resolvedoptions,
      }
    );
    return prepareNextState(state, response);
  };
}

export {
  as,
  combine,
  cursor,
  dataPath,
  dataValue,
  dateFns,
  each,
  field,
  fields,
  fn,
  fnIf,
  group,
  lastReferenceValue,
  map,
  merge,
  scrubEmojis,
  sourceValue,
  util,
} from '@openfn/language-common';
