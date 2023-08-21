import { Neurosity } from "@neurosity/sdk";
import { createClient } from "@supabase/supabase-js";
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

    let userId = ''
    for (const table in groupedBuffer) {
        try {
            const { error } = await supabase.from(table).upsert(groupedBuffer[table]);
            if (error) {
                console.error("Error while upserting data:", error);
            }
            userId = groupedBuffer[table][0].user_id
        } catch (error) {
            console.error("Unhandled error while upserting data:", error);
        }
    }

    console.log("Flushed buffer of size", buffer.length, "at", new Date(), "for user_id:", userId);
    buffer = [];
};

const app = express();
const port = process.env.PORT || 3001;

const server = app.listen(port, () => console.log(`Example app listening on port ${port}!`));

server.keepAliveTimeout = 120 * 1000;
server.headersTimeout = 120 * 1000;

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);

const listenedIds = {};

const listenToBrainForUser = async (userId: string, mediarUserId: string) => {
    const neurosity = new Neurosity();
    // await neurosity.logout();

    // @ts-ignore
    const token: string = await neurosity.getOAuthToken({
        clientId: process.env.NEUROSITY_OAUTH_CLIENT_ID!,
        clientSecret: process.env.NEUROSITY_OAUTH_CLIENT_SECRET!,
        userId: userId,
    });

    if (!token) {
        console.error("Failed to obtain token for userId:", userId);
        return;
    }

    console.log("Obtained token for userId:", userId);

    await neurosity.login({ customToken: token })
    let isReceivingFocus = true;

    console.log("Listening to brain for user_id:", userId);
    if (listenedIds[userId]) {
        console.log("Unlistening to previous brain for user_id:", userId);
        listenedIds[userId]();
    }
    listenedIds[userId] = () => isReceivingFocus = false;

    const u1 = neurosity.brainwaves("powerByBand").subscribe(async (powerByBand) => {
        const nf = {
            metadata: {
                ...powerByBand,
                provider: 'neurosity',
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
        //console.log("Focus received:", focus);

        const nf = {
            probability: focus.probability,
            metadata: {
                label: focus.label,
                provider: 'neurosity',
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

    u1.add(() => {
        delete listenedIds[mediarUserId];
    });

    u2.add(() => {
        delete listenedIds[mediarUserId];
    });

    const i = setInterval(async () => {
        if (!isReceivingFocus) {
            console.log("Logging out user_id:", userId);
            u1.unsubscribe();
            u2.unsubscribe();
            clearInterval(i);
        }
    }, 1000);
};

const getAllUsersAndListen = async () => {
    const { data: users, error } = await supabase.from('tokens').select('user_id,mediar_user_id')
        .eq('provider', 'neurosity');

    if (error) {
        console.log("error", error);
        return;
    }

    for (const user of users) {
        listenToBrainForUser(user.user_id, user.mediar_user_id)
            .catch(error => {
                console.log("Error listening to brain for userId:", user.user_id, error);
            });
    }
};

const listenForNewUsers = () => {
    supabase
        .channel('postgresChangesChannel')
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'users'
        },
            (payload) => {
                console.log('Change received!', payload);
                if (payload.eventType === 'INSERT') {
                    const newUser = payload.new['user_id'];
                    const mediarUserId = payload.new['mediar_user_id'];
                    listenToBrainForUser(newUser, mediarUserId)
                        .catch(error => {
                            console.log("Error listening to brain for userId:", newUser, error);
                        });
                }
            })
        .subscribe();
};

getAllUsersAndListen();
listenForNewUsers();
