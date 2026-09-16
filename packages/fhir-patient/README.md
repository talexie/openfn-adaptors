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

## Examples
- Create a tmp folder in the folder packages/fhir-patient and add file "fhir-cred.json"
- Run this command
 ```
 openfn examples/workflow.json -m -o tmp/output.json
 ```
