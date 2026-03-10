const fetchInstance = async () => {
    try {
        const response = await fetch('https://evolutionapi.landcriativa.com/instance/fetchInstances', {
            headers: {
                apikey: 'isfEQhkHq5tnvAa04A6VMisTec8JbvGW'
            }
        });
        const data = await response.json();
        console.log(JSON.stringify(data, null, 2));
    } catch (err) {
        console.error(err);
    }
};
fetchInstance();
