# language-fhir-patient <img src='./assets/square.png' width="30" height="30"/>

An OpenFn **_adaptor_** for building integration jobs for use with the
fhir-patient API.

## Documentation

View the
[docs site](https://docs.openfn.org/adaptors/packages/fhir-patient-docs) for
full technical documentation.

### Configuration

View the
[configuration-schema](https://docs.openfn.org/adaptors/packages/fhir-patient-configuration-schema/)
for required and optional `configuration` properties.

The configuration schema uses
[JSON Schema draft-07](https://json-schema.org/draft-07/json-schema-release-notes).
Run `pnpm validate:schemas` from the adaptors repo root after editing it.

## Development

Clone the [adaptors monorepo](https://github.com/OpenFn/adaptors). Follow the
"Getting Started" guide inside to get set up.

Run tests using `pnpm run test` or `pnpm run test:watch`

Build the project using `pnpm build`.

To build _only_ the docs run `pnpm build docs`.

## FHIR Documentation

The Restfull API can be seen here: https://www.hl7.org/fhir/http.html

### FHIR Bulk Export Documentation

The Bulk $export API can be found here: https://build.fhir.org/ig/HL7/bulk-data/en/async.html

### Important tips for Asynchronicity
To solve asynchronicity required by the Bulk $export API, Add header 'Prefer: respond-async' to FHIR KickOff request for Bulk $export 
```js
    downloadResource('Patient/DPW902300',{}, { 
        Prefer: 'respond-async'
    });
```
## Examples
- Create a tmp folder in the folder packages/fhir-patient and add file "fhir-cred.json"
- Run this command
 ```code
 openfn examples/workflow.json -m -o tmp/output.json
 ```

## Workflow Example
```js
downloadResource('Patient/DPW902300',{}, { 
    pollInterval: 1 
});

fn(state =>{
    each(
        state.data,
        (v)=>{
            // Send data to collections or AWS S3 storage or long-term storage
            put({
                bucket: 'openfn-test',
                key: v.file.url,
                body: v.file.url,
                contentType: 'application/fhir+ndjson'
            });
        }
    )
    return  state;
});
```
