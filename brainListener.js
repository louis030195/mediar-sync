const { Neurosity } = require("@neurosity/sdk");
const { createClient } = require("@supabase/supabase-js");
let buffer = [];
let bufferFlushTimeout;
const BUFFER_SIZE = 100;
const BUFFER_FLUSH_INTERVAL = 10 * 1000; // 10 seconds

const bufferData = async (data, table) => {
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

    const groupedBuffer = buffer.reduce((acc, item) => {
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
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const listenedIds = {};

const listenToBrainForUser = async (userId, mediarUserId) => {
    const neurosity = new Neurosity();
    // await neurosity.logout();

    // @ts-ignore
    const token = await neurosity.getOAuthToken({
        clientId: process.env.NEUROSITY_OAUTH_CLIENT_ID,
        clientSecret: process.env.NEUROSITY_OAUTH_CLIENT_SECRET,
        userId: userId,
    });

    if (!token) {
        console.error("Failed to obtain token for userId:", mediarUserId);
        return;
    }

    console.log("Obtained token for userId:", mediarUserId);

    // @ts-ignore
    neurosity.cloudClient.user = null;
    await neurosity.login({ customToken: token })
    let isReceivingFocus = true;

    console.log("Listening to brain for user_id:", mediarUserId);
    if (listenedIds[mediarUserId]) {
        console.log("Unlistening to previous brain for user_id:", mediarUserId);
        listenedIds[mediarUserId]();
    }
    listenedIds[mediarUserId] = () => isReceivingFocus = false;

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
        // console.log("Focus received:", focus);

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

process.on('message', ({ userId, mediarUserId }) => {
    listenToBrainForUser(userId, mediarUserId)
        .catch(error => {
            console.log("Error listening to brain for userId:", userId, error);
        });
});
