const { createClient } = require("@supabase/supabase-js");
const { fork } = require('child_process');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const listenToBrainForUserInChildProcess = (userId, mediarUserId) => {
    const child = fork('./brainListener.js');
    child.send({ userId, mediarUserId });
    child.on('exit', (code) => {
        if (code !== 0) {
            console.error(`Child process exited with code ${code}`);
        }
    });
};

const getAllUsersAndListen = async () => {
    const { data: users, error } = await supabase.from('tokens').select('user_id,mediar_user_id')
        .eq('provider', 'neurosity');

    if (error) {
        console.log("error", error);
        return;
    }

    for (const user of users) {
        listenToBrainForUserInChildProcess(user.user_id, user.mediar_user_id);
    }
};

const listenForNewTokens = () => {
    supabase
        .channel('postgresChangesChannel')
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'tokens'
        },
            (payload) => {
                console.log('Change received!', payload);
                if (payload.eventType === 'INSERT' && payload.new['provider'] !== "neurosity") {
                    const newUser = payload.new['user_id'];
                    const mediarUserId = payload.new['mediar_user_id'];
                    listenToBrainForUserInChildProcess(newUser, mediarUserId);
                }
            })
        .subscribe();
};

getAllUsersAndListen();
listenForNewTokens();
