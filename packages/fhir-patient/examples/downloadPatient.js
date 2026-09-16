// Download the Patient resource id: DPW902300

downloadResource('Patient/DPW902300',{}, { 
    pollInterval: 1 
});

fn(state =>{
    each(
        state.data,
        (v)=>{
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
