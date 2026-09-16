import { expect } from 'chai';

import { request, dataValue, get, downloadResource } from '../src/Adaptor.js';
import { testFixtures } from './Fixtures.js';
import { fileOrigin, requestConfig, testFileServer, testServer } from './MockClient.js';

const apiPath = requestConfig.apiPath;
const baseUrl = requestConfig.baseUrl;

const state = {
  configuration: requestConfig
}
const exportPath = (path: string) => (p: string) => p.startsWith(`/${apiPath}/${path}`);

const patient = (id: string) => ({ resourceType: 'Patient', id, active: true });
const ndjson = (resources: object[]) => resources.map(r => JSON.stringify(r)).join('\n') + '\n';
 
const manifest = (extra = {}) => ({
  transactionTime: '2026-09-11T00:00:00Z',
  request: `${baseUrl}/${apiPath}/Patient/DPW902300/$export`,
  requiresAccessToken: false,
  output: [
    { type: 'Patient', url: `${fileOrigin}/bulk/patients-1.ndjson`, count: 2 },
    { type: 'Patient', url: `${fileOrigin}/bulk/patients-2.ndjson`, count: 1 },
  ],
  error: [],
  ...extra,
});

/** 
 * Kick-off the pending FHIR bulk export 202 polls, then the manifest. 
 * Returns what the server saw. 
 */
const mockBulkExport = (options: { pending?: number; manifest?: object; path?: string } = {}) => {
  const seen: any = {};
  const statusUrl = `${baseUrl}/${apiPath}/status/abc`;
  let polls = 0;
 
  testServer
    .intercept({ 
      path: exportPath(options.path ?? 'Patient/DPW902300/$export'), 
      method: 'GET',
    })
    .reply(202, (req: any) => {
      seen.kickOff = req;
      return {};
    }, { headers: { 'content-location': statusUrl } })
    .persist();
 
  testServer
    .intercept({ 
      path: `/${apiPath}/status/abc`, 
      method: 'GET' 
    })
    .reply(() =>
      polls++ < (options.pending ?? 0)
        ? { 
          statusCode: 202, 
          data: {}, 
          responseOptions: { 
            headers: { 
              'retry-after': '0' 
            } 
          } 
        }
        : {
            statusCode: 200,
            data: options.manifest ?? manifest(),
            responseOptions: { 
              headers: { 
                'content-type': 'application/fhir+json' 
              } 
            },
          }
    )
    .persist();
 
  const fileContents: [number, object[]][] = [
    [1, [patient('p1'), patient('p2')]],
    [2, [patient('p3')]],
  ];
  for (const [n, resources] of fileContents) {
    testFileServer
      .intercept({ 
        path: `/bulk/patients-${n}.ndjson`, 
        method: 'GET' 
      })
      .reply(200, (req: any) => {
        (seen.files ??= []).push(req);
        return ndjson(resources);
      }, { 
        headers: { 
          'content-type': 'application/fhir+ndjson' 
        } 
      })
      .persist();
  }
 
  return { seen, statusUrl };
};

describe('download patient resource', () => {
  afterEach(() => {
    testServer.cleanMocks();
    testFileServer.cleanMocks();
  });
  
  it('kicks off, polls and downloads every resource into state.data', async () => {
    mockBulkExport({ pending: 2 });
 
    const finalState: any = await downloadResource('Patient/DPW902300',{}, { 
      pollInterval: 1 
    })(state);
 
    expect(finalState.resources.map((r: any) => r.id)).to.eql(['p1', 'p2', 'p3']);
    expect(finalState.manifest.transactionTime).to.eql('2026-09-11T00:00:00Z');
    expect(finalState.references).to.have.lengthOf(1); // previous state.data kept
  });
  
  it('should return an array of ndjson files', async () =>{
    mockBulkExport({ pending: 2 });
    const finalState = await downloadResource('Patient/DPW902300', {}, { 
      pollInterval: 1
    })(state);

    expect(finalState.manifest.output).to.be.an('array').with.lengthOf(2);
    expect(finalState.statusUrl).to.include('/status/abc');
  }),

  it('should fail with 400 Bad Request', async () => {
    testServer
      .intercept({
        path: exportPath('Patient/DPW902300/$export'),
        method: 'GET',
      })
      .reply(400, { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'invalid' }] });
 
    const error: any = await downloadResource('Patient/DPW902300')(state).catch(err => err);
 
    expect(error.statusCode).to.eql(400);
    expect(error.body.resourceType).to.eql('OperationOutcome');
  });
    
  it('should fail when the FHIR server accepts the export but returns no status URL', async () => {
    testServer
      .intercept({
        path: exportPath('Patient/DPW902300/$export'),
        method: 'GET',
      })
      .reply(202, {});
 
    const error: any = await downloadResource('Patient/DPW902300')(state).catch(err => err);
 
    expect(error.code).to.eql('NO_CONTENT_LOCATION');
  });
})

describe('Adaptor request', () => {
  it('should fetch the patient and return status code 200', async () =>{
    testServer
      .intercept({
        path: `${apiPath}/Patient/DPW902300`,
        method: 'GET'
      })
      .reply(200, testFixtures.getPatient)

    const finalState = await get('Patient/DPW902300')(state);

    expect(finalState.response.statusCode).to.eql(200);
    expect(finalState.data).to.eql(testFixtures.getPatient);

  })
  it('should fetch a patient with id: DPW902300', async () =>{
    testServer
      .intercept({
        path: `${apiPath}/Patient/DPW902300`,
        method: 'GET'
      })
      .reply(200, testFixtures.getPatient)

    const finalState = await request('GET', 'Patient/DPW902300', null)(state);

    expect(finalState.response.statusCode).to.eql(200);
    expect(finalState.data).to.eql(testFixtures.getPatient);

  })

  it('throws an error if the service returns 404', async () => {
    testServer
      .intercept({
        path: `${apiPath}/Patient/noAccess`,
        method: 'GET',
      })
      .reply(404);

    const error = await request('GET', 'Patient/noAccess', null )(
      state
    ).catch( err =>{
      return err;
    });
    expect(error.statusCode).to.eql(404);
    expect(error.statusMessage).to.eql('Not Found');
  });
});
