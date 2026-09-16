export const  testFixtures = {
    getPatient:{
        "resourceType": "Patient",
        "id": "DPW902300",
        "meta": {
            "versionId": "1",
            "lastUpdated": "2026-09-15T14:00:01.175-04:00",
            "source": "#pCmQysEWrQsPmVRk"
        },
        "text": {
            "status": "generated",
            "div": "<div xmlns=\"http://www.w3.org/1999/xhtml\"><div class=\"hapiHeaderText\"/><table class=\"hapiPropertyTable\"><tbody><tr><td>Identifier</td><td>DPW902300</td></tr><tr><td>Date of birth</td><td><span>21 August 2024</span></td></tr></tbody></table></div>"
        },
        "extension": [ {
            "url": "https://diagnosepro.com.br/fhir/StructureDefinition/cpf",
            "valueString": "13064269950"
        } ],
        "identifier": [ {
            "system": "https://diagnosepro.com.br/patient-id",
            "value": "DPW902300"
        } ],
        "active": true,
        "name": [ {
            "text": "Chen"
        } ],
        "birthDate": "2024-08-21"
    },
    downloadResourceNotAsync:{
        "resourceType": "OperationOutcome",
        "text": {
            "status": "generated",
            "div": "<div xmlns=\"http://www.w3.org/1999/xhtml\"><h1>Operation Outcome</h1><table border=\"0\"><tr><td style=\"font-weight: bold;\">ERROR</td><td>[]</td><td>HAPI-0513: Must request async processing for $export</td></tr></table></div>"
        },
        "issue": [ {
            "severity": "error",
            "code": "processing",
            "diagnostics": "HAPI-0513: Must request async processing for $export"
        } ]
    }
}