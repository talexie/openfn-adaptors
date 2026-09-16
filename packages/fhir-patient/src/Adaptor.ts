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
  PollOptions,
  prepareNextState,
  RequestOptions,
  sleep,
  toIsoFormat,
  toManifest,
  request as utilRequest 
} from './Utils.js';
import { DEFAULT_POLL_INTERVAL, DEFAULT_POLL_TIMEOUT, NDJSON } from './Constants.js';
import { collections } from '@openfn/language-collections';

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
 * Bulk export parameters, sent to the FHIR server when the export is kicked off.
 * @typedef {Object} ExportOptions
 * @public
 * @property {string} since - Only include resources changed at or after this instant (FHIR `_since`).
 * @property {string[]} types - Resource types to include (FHIR `_type`), eg `['Patient', 'Immunization']`.
 * @property {string[]} elements - Only include these elements (FHIR `_elements`), eg `['Patient.id']`.
 * @property {string[]} typeFilter - Search expressions narrowing a type (FHIR `_typeFilter`), eg `['Patient?gender=female']`.
 * @property {string} outputFormat - The file format to request. Default: `application/fhir+ndjson`.
 */
 
/**
 * Options controlling how the export is polled and downloaded.
 * @typedef {Object} PollOptions
 * @public
 * @property {number} pollInterval - Milliseconds between status polls when the server sends no `Retry-After`. Default: 5000.
 * @property {number} pollTimeout - Give up waiting after this many milliseconds. Default: 1800000 (30 minutes).
 * @property {string[]} types - Only download files of these resource types.
 * @property {number} max - Stop after this many resources.
 * @property {boolean} includeErrors - Download the server's error files too. Default: true.
 * @property {string} collection - Buffer resources into this OpenFn collection instead of holding them in state.
 * @property {object} headers - An object of headers to append to each request.
 * @property {number} timeout - Request timeout in ms.
 */

/**
 * State object
 * @typedef {Object} FhirExportState
 * @private
 * @property data - the exported resources, as an array
 * @property response - the final response from the FHIR server, including headers, statusCode and body
 * @property manifest - the server's export manifest, including `transactionTime` and the list of files
 * @property statusUrl - the export's status URL, which can be polled again later
 * @property issues - OperationOutcomes for records the server could not export
 * @property references - an array of all previous data objects used in the Job
 **/

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
 * Download every resource of a type from a FHIR server using Bulk Data `$export`.
 *
 * The export is asynchronous: this kicks it off, polls until the server has written
 * its NDJSON files, then downloads and parses them. See the
 * {@link https://build.fhir.org/ig/HL7/bulk-data/en/export.html Bulk Data Access IG}.
 *
 * Resources are held in memory. For large populations, narrow the export with `since`
 * or `types`, cap it with `max`, or buffer it with `collection`.
 * @public
 * @function
 * @param {string} path - The resource to export, eg `Patient` or `Group/[id]`. Default: `Patient`.
 * @param {ExportOptions} params - FHIR bulk export parameters.
 * @param {PollOptions} options - Polling and download options.
 * @state {FhirExportState}
 * @returns {Operation}
 * @example <caption>Download every patient</caption>
 * downloadResource('Patient');
 * @example <caption>Download only what changed since the last run</caption>
 * downloadResource('Patient', { since: $.cursor, types: ['Patient', 'Immunization'] });
 * @example <caption>Export one group, buffering into a collection</caption>
 * downloadResource('Group/measles-campaign', {}, { collection: 'fhir-export-buffer' });
 */
export function downloadResource (
  path: string = 'Patient', 
  params: ExportOptions = {},
  options: PollOptions = {}
) {
  return async (state: any) => {
    const [resolvedPath, resolvedOptions] =
      expandReferences(state, path, options);

    const statusUrl = await kickOffRequest(resolvedPath, state, params, resolvedOptions);
    state.statusUrl = statusUrl;
    const { manifest, response } = await pollRequest(state, statusUrl, resolvedOptions);
    const { resources, issues } = await collectRequest(state, manifest, resolvedOptions);
    const nextState = prepareNextState(state, response);
    
    nextState.manifest = manifest;
    nextState.data = resources;
    if (issues.length) nextState.issues = issues;

    return nextState;
  };
}
/**
 * Kick-off request for FHIR Asynchronous Bulk Export
 * @private
 * @function
 * @param {string} path - Path to the FHIR resource e.g Patient
 * @param {any} state - HttpState
 * @param {Object} params  - FHIR bulk $export parameters
 * @param {ExportOptions } options  - Bulk export parameters, sent to the FHIR server when the export is kicked off.
 * @returns Promise<string>
 * @link https://build.fhir.org/ig/HL7/bulk-data/en/async.html
 */

export async function kickOffRequest (
  path: string = 'Patient', 
  state: any,
  params: Record<string,any> = {},
  options: ExportOptions & RequestOptions = {}
): Promise<string>  {
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
        ...headers,
        Accept: 'application/fhir+json',
        Prefer: 'respond-async'
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
 * @private
 * @function
 * @param state - HttpState
 * @param statusUrl - FHIR server status content location after kickoff request
 * @param options -  FHIR bulk $export polling and download options.
 * @returns Promise<ManifestResponse>
 */
export async function pollRequest (
  state: any, 
  statusUrl: string, 
  options: PollOptions = {}
): Promise<ManifestResponse> {
  const { 
    pollInterval = DEFAULT_POLL_INTERVAL, 
    pollTimeout = DEFAULT_POLL_TIMEOUT 
  } = options;
  const startedAt = Date.now();

   for (;;) {
    const response = await absoluteRequest('GET', statusUrl, state.configuration, {
      headers: { 
        Accept: 'application/fhir+json',
      },
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
 * @private
 * @function
 * @param {any} state - HttpState
 * @param {ExportManifest} manifest - FHIR bulk $export file manifest options.
 * @param {PollOptions} options  - FHIR bulk $export polling and download options.
 * @returns {Operation}
 */
export async function collectRequest (
  state: any, 
  manifest: ExportManifest, 
  options: PollOptions = {}
) {
  const { 
    types, 
    max = Infinity, 
    includeErrors = true,
    collection,
    batchSize = 500 
  } = options;
  const collectionName =
    typeof collection === 'string'
      ? collection
      : collection
        ? `fhir-export-${manifest.transactionTime || 'buffer'}`
        : undefined;
 
  const resources: any[] = [];
  let count = 0;

  for (const file of manifest.output) {
    if (types && !types.includes(file.type)) continue;
    if (count >= max) break;
    
    if (collectionName) {
      // Straight from the socket to the Collection: nothing accumulates in state.
      count += await streamToCollection(state, file,manifest, {
        ...options,
        collectionName,
        batchSize,
        max: max - count,
      });
    }
    else{
 
      for await (const resource of streamNdJsonFile(state, file, manifest, {
        ...options, parseAs: 'stream'})) {
        resources.push(resource);
        if (++count >= max) break;
      }
    }
  }
 
  const issues: any[] = [];
  if (includeErrors) {
    for (const file of manifest.error) {
      for await (const issue of streamNdJsonFile(state, file, manifest, {...options, parseAs: 'stream'})) issues.push(issue);
    }
    if (issues.length){
      throwError('NO_EXPORT_REPORTED',{
        description: "FHIR server reported issues during bulk export",
        fix: 'Check if the FHIR server supports bulk export $xport'
      })
    }
  }
 
  return collectionName ? { resources, issues, collection: collectionName, count } : { resources, issues, count };
}

/**
 * Stream FHIR NDJSON file to openFn Collection for temporary storage since the files are big
 * @private
 * @function
 * @param { any } state - The OpenFn state with configuration
 * @param { ExportFile } file - FHIR bulk $export file manifest options
 * @param { ExportManifest} manifest  - The FHIR bulk $export manifest
 * @param { PollOptions } options - FHIR bulk $export polling and downloading options
 * @returns Promise<number>
 */
export async function streamToCollection (
  state: any,
  file: ExportFile,
  manifest: ExportManifest, 
  options: PollOptions & { collectionName: string } = {
    collectionName : 'fhir-export-patient-buffer',
    batchSize: 500
  }
): Promise<number> {
  
  const { collectionName, batchSize = 500, max = Infinity } = options;
  let batch: any[] = [];
  let written = 0;
  const fileType = file.type?.toLowerCase() || 'resource';

  // Helper utility to flush accumulated data into the OpenFn Collection
  const flushBatch = async () => {
    if (!batch.length) return;
    await collections.set(
      collectionName,
       (resource: any, _state: any, index: number) =>
        // Keys like 'patient:DPW902300'
        resource?.id ? `${fileType}:${resource.id}` : `${fileType}:${file.url.split('/').pop()}:${written + index}`,
      batch
    )(state);
    written += batch.length;
    batch = [];
  };

  for await (const resource of streamNdJsonFile(state, file, manifest, options)) {
    batch.push(resource);
    if (written + batch.length >= max) break;
    if (batch.length >= batchSize) await flushBatch();
  }

  await flushBatch()
  return written;
};

/**
 * Stream one FHIR NDJSON file, yielding a resource per line.
 * @private
 * @function
 * @param {any} state - HttpState
 * @param {ExportFile} file - FHIR bulk $export file manifest options
 * @param {ExportManifest} manifest - The FHIR bulk $export manifest options
 * @param {RequestOptions} options - Http request additional parameters
 * @returns AsyncGenerator
 */
export async  function* streamNdJsonFile (
  state: any, 
  file: ExportFile, 
  manifest: ExportManifest, 
  options: RequestOptions
) {
   const response = await absoluteRequest('GET', file.url, state.configuration, {
    ...options,
    headers: { 
      ...options.headers,
      Accept: NDJSON,      
   },
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
export function get (path: string , options: RequestOptions = {}) {
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
export function post (path: string , body: Record<string, any>, options: RequestOptions = {}) {
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
export function request (
  method: string, 
  path: string,
  body: Record<string,any> | null, 
  options: RequestOptions = {}
) {
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
