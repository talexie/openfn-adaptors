import { expect } from 'chai';

import { testFixtures } from './Fixtures.js';
import { absoluteRequest, request } from '../src/Utils.js';
import { requestConfig, testServer } from './MockClient.js';

const state = requestConfig;

describe('Utils request', () => {
  it('should return a patient with id: DPW902300', async () =>{
    testServer
      .intercept({
        path: `${requestConfig.apiPath}/Patient/DPW902300`,
        method: 'GET'
      })
      .reply(200, testFixtures.getPatient)

    const response = await request('GET', 'Patient/DPW902300', state);
    
    expect(response.statusCode).to.eql(200);
    expect(response.body).to.eql(testFixtures.getPatient);

  })
})

describe('Utils absolute request', () => {
  it('should return a patient with id: DPW902300', async () =>{
    testServer
      .intercept({
        path: `${requestConfig.apiPath}/Patient/DPW902300`,
        method: 'GET'
      })
      .reply(200, testFixtures.getPatient)

    const response = await absoluteRequest('GET', `${requestConfig.baseUrl}/${requestConfig.apiPath}/Patient/DPW902300`, state);
    
    expect(response.statusCode).to.eql(200);
    expect(response.body).to.eql(testFixtures.getPatient);

  })
})
