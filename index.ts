import { Neurosity } from "@neurosity/sdk";
import { Session, SupabaseClient, createClient } from "@supabase/supabase-js";
import express from "express";
const BUFFER_SIZE = 100;
const BUFFER_FLUSH_INTERVAL = 10 * 1000; // 10 seconds

let buffer: any = [];
let bufferFlushTimeout: any;

const bufferData = async (data: any, table: any) => {
    buffer.push({ data, table });

    if (buffer.length >= BUFFER_SIZE) {
        await flushBuffer();
    } else if (!bufferFlushTimeout) {
        bufferFlushTimeout = setTimeout(flushBuffer, BUFFER_FLUSH_INTERVAL);
    }
};

const flushBuffer = async () => {
    clearTimeout(bufferFlushTimeout);
    bufferFlushTimeout = null;

    const groupedBuffer = buffer.reduce((acc: any, item: any) => {
        acc[item.table] = acc[item.table] || [];
        acc[item.table].push(item.data);
        return acc;
    }, {});

    for (const table in groupedBuffer) {
        try {
            const { error } = await supabase.from(table).upsert(groupedBuffer[table]);
            if (error) {
                console.error("Error while upserting data:", error);
            }
        } catch (error) {
            console.error("Unhandled error while upserting data:", error);
        }
    }

    console.log("Flushed buffer of size", buffer.length);

    buffer = [];
};


const app = express();
const port = process.env.PORT || 3001;

const server = app.listen(port, () => console.log(`Example app listening on port ${port}!`));

server.keepAliveTimeout = 120 * 1000;
server.headersTimeout = 120 * 1000;

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);

const listenedIds = {}

const listenToBrain = async (token: string, timeoutMs = 10_000) => {
    const neurosity = new Neurosity();
    await neurosity.logout();
    await neurosity.login({ customToken: token });

    let isReceivingFocus = false;

    // Retrieve user_id from the tokens table
    const { data, error } = await supabase
        .from('tokens')
        .select('mediar_user_id')
        .eq('token', token);

    if (error) {
        console.error('Error retrieving mediar_user_id:', error);
        return;
    }

    const mediarUserId = data[0].mediar_user_id;

    console.log("Listening to brain for mediar_user_id:", mediarUserId);

    listenedIds[mediarUserId] = () => isReceivingFocus = false

    const u1 = neurosity.brainwaves("powerByBand").subscribe(async (powerByBand) => {
        isReceivingFocus = true;

        // console.log("powerByBand", powerByBand);
        const nf = {
            metadata: {
                ...powerByBand
            },
            user_id: mediarUserId,
        }
        try {
            await bufferData(nf, 'states');
        } catch (error) {
            console.log("Error buffering data:", error);
            u1.unsubscribe();
        }
    })

    const u2 = neurosity.focus().subscribe(async (focus) => {
        isReceivingFocus = true;

        // console.log("focus", focus);
        const nf = {
            probability: focus.probability,
            metadata: {
                label: focus.label,
            },
            user_id: mediarUserId,
        }
        try {
            await bufferData(nf, 'states');
        } catch (error) {
            console.log("Error buffering data:", error);
            u2.unsubscribe();
        }
    });

    const u3 = neurosity.calm().subscribe(async (calm) => {
        isReceivingFocus = true;

        // console.log("calm", calm);
        const nf = {
            probability: calm.probability,
            metadata: {
                label: calm.label,
            },
            user_id: mediarUserId,
        }
        try {
            await bufferData(nf, 'states');
        } catch (error) {
            console.log("Error buffering calm data:", error);
            u3.unsubscribe();
        }
    });

    u1.add(() => {
        delete listenedIds[mediarUserId];
    });
    
    u2.add(() => {
        delete listenedIds[mediarUserId];
    });
    
    u3.add(() => {
        delete listenedIds[mediarUserId];
    });
    

    await new Promise((resolve, reject) => {
        setTimeout(async () => {
            if (!isReceivingFocus) {
                u1.unsubscribe();
                u2.unsubscribe();
                u3.unsubscribe();
                reject(new Error("No data received from brainwaves in the specified timeout"));
            }
            console.log("🧠 Got some data from brainwaves");
        }, timeoutMs);
    });

    return { unsubscribe1: u1.unsubscribe, unsubscribe2: u2.unsubscribe, unsubscribe3: u3.unsubscribe };
}

const getAllTokensAndListen = async () => {
    const { data: tokens, error } = await supabase.from('tokens').select('token');

    if (error) {
        console.log("error", error);
        return;
    }

    for (const token of tokens) {
        listenToBrain(token.token)
            .catch(async error => {
                console.log("Error listening to brain for token:", token, error);

                const { error: updateError } = await supabase
                    .from('tokens')
                    .update({ status: { valid: false } })
                    .eq('token', token.token);
                if (updateError) {
                    console.log("Error setting token status to off:", token, updateError);
                }
            });
    }
}

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
                if (payload.eventType === 'UPDATE') {
                    console.log("update event on", payload);
                }
                // Get the new token from the payload and start listening to the brain
                const newToken = payload.new['token'];
                listenToBrain(newToken)
                    .catch(async error => {
                        console.log("Error listening to brain for token:", newToken, error);

                        const { error: updateError } = await supabase
                            .from('tokens')
                            .update({ status: { valid: false } })
                            .eq('token', newToken);
                        if (updateError) {
                            console.log("Error setting token status to off:", newToken, updateError);
                        }
                    });
            })
        .subscribe();
}

getAllTokensAndListen();
listenForNewTokens();
