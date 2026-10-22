
const e=require(`../chunks/chunk-DzJ5_V0X.js`),t=require(`../chunks/emoji.std-Crs2Ponm.js`),n=require(`../chunks/log.std-BxHXWNJw.js`),r=require(`../chunks/errors.std-7sZchtic.js`),i=require(`../chunks/Reactions.std-Rn_Omwwu.js`);let a=require(`node:path`),o=require(`node:crypto`),s=require(`node:fs`),c=require(`node:assert`);c=e.o(c);let l=require(`node:util`),u=require(`node:worker_threads`),d=require(`node:v8`),f=require(`@signalapp/ringrtc`),p=require(`@signalapp/sqlcipher`);p=e.o(p);var m=e.o(t.is());t.Na(),t.Oa(),n.f(),n.n(),t.Ii(),i.Zr(),i.Yr(),i.zr(),i.lr(),i.ir(),i.nr(),i.ct(),i.rt(),i.A(),i.n();const h={fatal(...e){console.error(...e)},error(...e){console.error(...e)},warn(...e){console.warn(...e)},info(...e){console.info(...e)},debug(...e){console.debug(...e)},trace(...e){console.log(...e)},child(){return h}};t.ga(),t.g(),t.m(),t.d(),i.or(),t.cn(),i.Mr();function g(e){let t=e.prepare(`SELECT json FROM items WHERE id = $id;`).get({id:`uuid_id`});if(!t)return;let{value:n}=JSON.parse(t.json),[r]=i.Nr(String(n).toLowerCase());return r}function _(e,n){let r=e.prepare(`
    SELECT uuid
    FROM
      conversations
    WHERE
      id = $conversationId
    `,{pluck:!0}),a=e.prepare(`
      SELECT uuid, e164, active_at
      FROM
        conversations
      WHERE
        id = $conversationId
    `),o=(e,t)=>{let n=a.get({conversationId:e}),r=a.get({conversationId:t}),i=!!(n?.uuid&&n?.e164),o=!!(r?.uuid&&r?.e164);return!i&&!o?0:i?o?(n?.active_at??0)-(r?.active_at??0):1:-1},s=()=>{let n=[e.prepare(`DELETE FROM senderKeys`).run().changes,e.prepare(`DELETE FROM sessions`).run().changes,e.prepare(`DELETE FROM signedPreKeys`).run().changes,e.prepare(`DELETE FROM preKeys`).run().changes].reduce((e,t)=>e+t);return t.fn(e,`items`,`identityKey`),t.fn(e,`items`,`registrationId`),n},c=n=>{let r=t.nn(e,`items`,`identityKey`),i=t.nn(e,`items`,`registrationId`);r&&t.en(e,`items`,{id:`identityKeyMap`,value:{[n]:r.value}}),i&&t.en(e,`items`,{id:`registrationIdMap`,value:{[n]:i.value}}),e.exec(`
      DELETE FROM items WHERE id = 'identityKey' OR id = 'registrationId';
      `)},l=t=>{for(let n of[`signedPreKeys`,`preKeys`])e.prepare(`
        UPDATE ${n}
        SET
          id = $ourUuid || ':' || id,
          json = json_set(
            json,
            '$.id',
            $ourUuid || ':' || json_extract(json, '$.id'),
            '$.keyId',
            json_extract(json, '$.id'),
            '$.ourUuid',
            $ourUuid
          )
        `).run({ourUuid:t})},u=t=>{let a=e.prepare(`SELECT id, senderId, lastUpdatedDate FROM senderKeys`).all();n.info(`Updating ${a.length} sender keys`);let s=e.prepare(`
      UPDATE senderKeys
      SET
        id = $newId,
        senderId = $newSenderId
      WHERE
        id = $id
      `),c=e.prepare(`DELETE FROM senderKeys WHERE id = $id`),l=new Map,u=0,d=0,f=0;for(let{id:e,senderId:n,lastUpdatedDate:p}of a){let[a]=i.Nr(n),m=r.get({conversationId:a});if(!m){d+=1,c.run({id:e});continue}let h=`${t}:${e.replace(a,m)}`,g=l.get(h);if(g?f+=1:u+=1,g&&(p<g.lastUpdatedDate||o(a,g.conversationId)<0)){c.run({id:e});continue}else g&&c.run({id:h});l.set(h,{conversationId:a,lastUpdatedDate:p}),s.run({id:e,newId:h,newSenderId:n.replace(a,m)})}n.info(`Updated ${a.length} sender keys: updated: ${u}, deleted: ${d}, skipped: ${f}`)},d=t=>{let i=e.prepare(`SELECT id, conversationId FROM SESSIONS`).all();n.info(`Updating ${i.length} sessions`);let a=e.prepare(`
      UPDATE sessions
      SET
        id = $newId,
        ourUuid = $ourUuid,
        uuid = $uuid,
        json = json_set(
          sessions.json,
          '$.id',
          $newId,
          '$.uuid',
          $uuid,
          '$.ourUuid',
          $ourUuid
        )
      WHERE
        id = $id
      `),s=e.prepare(`DELETE FROM sessions WHERE id = $id`),c=new Map,l=0,u=0,d=0;for(let{id:e,conversationId:n}of i){let i=r.get({conversationId:n});if(!i){u+=1,s.run({id:e});continue}let f=`${t}:${e.replace(n,i)}`,p=c.get(f);if(p?d+=1:l+=1,p&&o(n,p.conversationId)<0){s.run({id:e});continue}else p&&s.run({id:f});c.set(f,{conversationId:n}),a.run({id:e,newId:f,uuid:i,ourUuid:t})}n.info(`Updated ${i.length} sessions: updated: ${l}, deleted: ${u}, skipped: ${d}`)},f=()=>{let t=e.prepare(`SELECT id FROM identityKeys`).all();n.info(`Updating ${t.length} identity keys`);let i=e.prepare(`
      UPDATE OR REPLACE identityKeys
      SET
        id = $newId,
        json = json_set(
          identityKeys.json,
          '$.id',
          $newId
        )
      WHERE
        id = $id
      `),a=0;for(let{id:e}of t){let t=r.get({conversationId:e}),n;t?(a+=1,n=t):n=`conversation:${e}`,i.run({id:e,newId:n})}n.info(`Migrated ${a} identity keys`)};e.exec(`
    -- Change type of 'id' column from INTEGER to STRING

    ALTER TABLE preKeys
    RENAME TO old_preKeys;

    ALTER TABLE signedPreKeys
    RENAME TO old_signedPreKeys;

    CREATE TABLE preKeys(
      id STRING PRIMARY KEY ASC,
      json TEXT
    );
    CREATE TABLE signedPreKeys(
      id STRING PRIMARY KEY ASC,
      json TEXT
    );

    -- sqlite handles the type conversion
    INSERT INTO preKeys SELECT * FROM old_preKeys;
    INSERT INTO signedPreKeys SELECT * FROM old_signedPreKeys;

    DROP TABLE old_preKeys;
    DROP TABLE old_signedPreKeys;

    -- Alter sessions

    ALTER TABLE sessions
      ADD COLUMN ourUuid STRING;

    ALTER TABLE sessions
      ADD COLUMN uuid STRING;
    `);let p=g(e);if(!i.Qr(p)){let e=s();e>0&&n.error(`no uuid is available, erased ${e} sessions/keys`);return}l(p),u(p),d(p),c(p),f()}t.cn();function v(e,n){e.exec(`
    DROP TRIGGER messages_on_delete;

    CREATE TRIGGER messages_on_delete AFTER DELETE ON messages BEGIN
      DELETE FROM messages_fts WHERE rowid = old.rowid;
      DELETE FROM sendLogPayloads WHERE id IN (
        SELECT payloadId FROM sendLogMessageIds
        WHERE messageId = old.id
      );
      DELETE FROM reactions WHERE rowid IN (
        SELECT rowid FROM reactions
        WHERE messageId = old.id
      );
    END;
  `);let r=e.prepare(`SELECT id FROM messages ORDER BY id ASC;`,{pluck:!0}).all(),i=e.prepare(`SELECT rowid, messageId FROM reactions;`).all(),a=new Set(r),o=[];i.forEach(e=>{a.has(e.messageId)||o.push(e.rowid)});function s(t,n){e.prepare(`
      DELETE FROM reactions
      WHERE rowid IN ( ${t.map(()=>`?`).join(`, `)} );
      `,{persistent:n}).run(t)}o.length>0&&(n.info(`Deleting ${o.length} orphaned reactions`),t.Xt(e,o,s))}i.$n(),t.cn();const{omit:y}=m.default;function b(e,n){let r=e.prepare(`
  SELECT uuid
  FROM
    conversations
  WHERE
    id = $conversationId
  `,{pluck:!0}),a=e.prepare(`
    UPDATE conversations SET
      json = $json,
      members = $members
    WHERE id = $id;
    `),o=e.prepare(`
    UPDATE messages SET
      json = $json,
      sourceUuid = $sourceUuid
    WHERE id = $id;
    `),s=e=>{let i=e,o=e,s=`(${i.id}) groupv2(${i.groupId})`;for(let e of[`membersV2`,`pendingMembersV2`,`pendingAdminApprovalV2`]){let a=i[e];if(!Array.isArray(a))continue;let c=0,l=a.map(t=>{let i=r.get({conversationId:t.conversationId});if(!i){n.warn(`${s}.${e} UUID not found for ${t.conversationId}`);return}let a={...y(t,`conversationId`),uuid:i};if(!(`addedByUserId`in t)||!t.addedByUserId)return a;let o=r.get({conversationId:t.addedByUserId});return o?(c+=1,{...a,addedByUserId:o}):a}).filter(t._a);o={...o,[e]:l},a.length!==0&&n.info(`migrated ${a.length} ${e} entries to ${l.length} for ${s}`),c>0&&n.info(`migrated ${c} addedByUserId in ${e} for ${s}`)}if(o===e)return;let c;c=o.membersV2?o.membersV2.map(e=>e.uuid).join(` `):o.members?o.members.join(` `):null,a.run({id:o.id,json:t.un(o),members:c})},c=e=>{let{id:a,groupV2Change:s,sourceUuid:c,invitedGV2Members:l}=e,u=e;if(s){t.Fi(u.groupV2Change,`Pacify typescript`);let e=r.get({conversationId:s.from});u=e?{...u,groupV2Change:{...u.groupV2Change,from:e}}:{...u,groupV2Change:y(u.groupV2Change,[`from`])};let i=!1,o=s.details.map((e,o)=>{let s=u.groupV2Change?.details[o];t.Fi(s,`Pacify typescript`);let c=s;for(let o of[`conversationId`,`inviter`]){let s=e[o],l=o===`conversationId`?`uuid`:o;if(s===void 0)continue;i=!0;let u=r.get({conversationId:s});if(!(o===`inviter`&&!u)){if(!u){n.warn(`${a}.groupV2Change.details.${o} UUID not found for ${s}`);return}t.Fi(c.type===e.type,`Pacify typescript`),c={...y(c,o),[l]:u}}}return c}).filter(t._a);i&&(u={...u,groupV2Change:{...u.groupV2Change,details:o}})}if(c){let e=r.get({conversationId:c});e&&(u={...u,sourceUuid:e})}if(l){let e=l.map(({addedByUserId:e,conversationId:o},s)=>{let c=r.get({conversationId:o}),l=u.invitedGV2Members&&u.invitedGV2Members[s];if(t.Fi(l!==void 0,`Pacify typescript`),!c){n.warn(`${a}.invitedGV2Members UUID not found for ${o}`);return}let d={...y(l,[`conversationId`]),uuid:c};if(!e)return d;let f=r.get({conversationId:e});return f?{...d,addedByUserId:i.er(f,`migration-43`)}:d}).filter(t._a);u={...u,invitedGV2Members:e}}return u===e?!1:(o.run({id:u.id,json:JSON.stringify(u),sourceUuid:u.sourceUuid??null}),!0)},l=e.prepare(`
    SELECT json
    FROM conversations
    ORDER BY id ASC;
    `,{pluck:!0}).all().map(e=>t.ln(e));n.info(`About to iterate through ${l.length} conversations`);for(let e of l)s(e);let u=t.rn(e,`messages`);n.info(`About to iterate through ${u} messages`);let d=0;for(let n of new t.Yt(e,`messages`))c(n)&&(d+=1);n.info(`Updated ${d} messages`)}function x(e){e.exec(`
    CREATE TABLE badges(
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      descriptionTemplate TEXT NOT NULL
    );

    CREATE TABLE badgeImageFiles(
      badgeId TEXT REFERENCES badges(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,
      'order' INTEGER NOT NULL,
      url TEXT NOT NULL,
      localPath TEXT,
      theme TEXT NOT NULL
    );
    `)}function S(e){e.exec(`
    --- Add column to messages table

    ALTER TABLE messages ADD COLUMN storyId STRING;

    --- Update important message indices

    DROP INDEX   messages_conversation;
    CREATE INDEX messages_conversation ON messages
      (conversationId, type, storyId, received_at);

    DROP INDEX   messages_unread;
    CREATE INDEX messages_unread ON messages
      (conversationId, readStatus, type, storyId) WHERE readStatus IS NOT NULL;

    --- Update attachment indices for All Media views

    DROP INDEX   messages_hasAttachments;
    CREATE INDEX messages_hasAttachments
      ON messages (conversationId, hasAttachments, received_at)
      WHERE type IS NOT 'story' AND storyId IS NULL;

    DROP INDEX   messages_hasFileAttachments;
    CREATE INDEX messages_hasFileAttachments
      ON messages (conversationId, hasFileAttachments, received_at)
      WHERE type IS NOT 'story' AND storyId IS NULL;

    DROP INDEX   messages_hasVisualMediaAttachments;
    CREATE INDEX messages_hasVisualMediaAttachments
      ON messages (conversationId, hasVisualMediaAttachments, received_at)
      WHERE type IS NOT 'story' AND storyId IS NULL;

    --- Message insert/update triggers to exclude stories and story replies

    DROP   TRIGGER messages_on_insert;
    -- Note: any changes to this trigger must be reflected in 
    -- Server.ts: enableMessageInsertTriggersAndBackfill
    CREATE TRIGGER messages_on_insert AFTER INSERT ON messages
    WHEN new.isViewOnce IS NOT 1 AND new.storyId IS NULL
    BEGIN
      INSERT INTO messages_fts
        (rowid, body)
      VALUES
        (new.rowid, new.body);
    END;

    DROP   TRIGGER messages_on_update;
    CREATE TRIGGER messages_on_update AFTER UPDATE ON messages
    WHEN
      (new.body IS NULL OR old.body IS NOT new.body) AND
       new.isViewOnce IS NOT 1 AND new.storyId IS NULL
    BEGIN
      DELETE FROM messages_fts WHERE rowid = old.rowid;
      INSERT INTO messages_fts
        (rowid, body)
      VALUES
        (new.rowid, new.body);
    END;

    --- Update delete trigger to remove storyReads

    --- Note: for future updates to this trigger, be sure to update Server.ts/removeAll()
    ---       (it deletes and re-adds this trigger for performance)
    DROP   TRIGGER messages_on_delete;
    CREATE TRIGGER messages_on_delete AFTER DELETE ON messages BEGIN
      DELETE FROM messages_fts WHERE rowid = old.rowid;
      DELETE FROM sendLogPayloads WHERE id IN (
        SELECT payloadId FROM sendLogMessageIds
        WHERE messageId = old.id
      );
      DELETE FROM reactions WHERE rowid IN (
        SELECT rowid FROM reactions
        WHERE messageId = old.id
      );
      DELETE FROM storyReads WHERE storyId = old.storyId;
    END;

    --- Story Read History

    CREATE TABLE storyReads (
      authorId STRING NOT NULL,
      conversationId STRING NOT NULL,
      storyId STRING NOT NULL,
      storyReadDate NUMBER NOT NULL,

      PRIMARY KEY (authorId, storyId)
    );

    CREATE INDEX storyReads_data ON storyReads (
      storyReadDate, authorId, conversationId
    );

    --- Story Distribution Lists

    CREATE TABLE storyDistributions(
      id STRING PRIMARY KEY NOT NULL,
      name TEXT,

      avatarUrlPath TEXT,
      avatarKey BLOB,
      senderKeyInfoJson STRING
    );

    CREATE TABLE storyDistributionMembers(
      listId STRING NOT NULL REFERENCES storyDistributions(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,
      uuid STRING NOT NULL,

      PRIMARY KEY (listId, uuid)
    )
    `)}function ee(e){e.exec(`
    --- Add column to messages table

    ALTER TABLE messages
    ADD COLUMN
    isStory INTEGER
    GENERATED ALWAYS
    AS (type = 'story');

    --- Update important message indices

    DROP INDEX   messages_conversation;
    CREATE INDEX messages_conversation ON messages
      (conversationId, isStory, storyId, received_at, sent_at);
    `)}function te(e,t){e.exec(`
    DROP INDEX   messages_conversation;

    ALTER TABLE messages
      DROP COLUMN isStory;
    ALTER TABLE messages
      ADD COLUMN isStory INTEGER
      GENERATED ALWAYS AS (type IS 'story');

    ALTER TABLE messages
      ADD COLUMN isChangeCreatedByUs INTEGER NOT NULL DEFAULT 0;

    ALTER TABLE messages
      ADD COLUMN shouldAffectActivity INTEGER
      GENERATED ALWAYS AS (
        type IS NULL
        OR
        type NOT IN (
          'change-number-notification',
          'group-v1-migration',
          'message-history-unsynced',
          'profile-change',
          'story',
          'universal-timer-notification',
          'verified-change',

          'keychange'
        )
      );

    ALTER TABLE messages
      ADD COLUMN shouldAffectPreview INTEGER
      GENERATED ALWAYS AS (
        type IS NULL
        OR
        type NOT IN (
          'change-number-notification',
          'group-v1-migration',
          'message-history-unsynced',
          'profile-change',
          'story',
          'universal-timer-notification',
          'verified-change'
        )
      );

    ALTER TABLE messages
      ADD COLUMN isUserInitiatedMessage INTEGER
      GENERATED ALWAYS AS (
        type IS NULL
        OR
        type NOT IN (
          'change-number-notification',
          'group-v1-migration',
          'message-history-unsynced',
          'profile-change',
          'story',
          'universal-timer-notification',
          'verified-change',

          'group-v2-change',
          'keychange'
        )
      );

    ALTER TABLE messages
      ADD COLUMN isTimerChangeFromSync INTEGER
      GENERATED ALWAYS AS (
        json_extract(json, '$.expirationTimerUpdate.fromSync') IS 1
      );

    ALTER TABLE messages
      ADD COLUMN isGroupLeaveEvent INTEGER
      GENERATED ALWAYS AS (
        type IS 'group-v2-change' AND
        json_array_length(json_extract(json, '$.groupV2Change.details')) IS 1 AND
        json_extract(json, '$.groupV2Change.details[0].type') IS 'member-remove' AND
        json_extract(json, '$.groupV2Change.from') IS NOT NULL AND
        json_extract(json, '$.groupV2Change.from') IS json_extract(json, '$.groupV2Change.details[0].uuid')
      );

    ALTER TABLE messages
      ADD COLUMN isGroupLeaveEventFromOther INTEGER
      GENERATED ALWAYS AS (
        isGroupLeaveEvent IS 1
        AND
        isChangeCreatedByUs IS 0
      );

    CREATE INDEX messages_conversation ON messages
      (conversationId, isStory, storyId, received_at, sent_at);

    CREATE INDEX messages_preview ON messages
      (conversationId, shouldAffectPreview, isGroupLeaveEventFromOther, expiresAt, received_at, sent_at);

    CREATE INDEX messages_activity ON messages
      (conversationId, shouldAffectActivity, isTimerChangeFromSync, isGroupLeaveEventFromOther, received_at, sent_at);

    CREATE INDEX message_user_initiated ON messages (isUserInitiatedMessage);
    `);let n=g(e);n?e.prepare(`
      UPDATE messages SET
        isChangeCreatedByUs = json_extract(json, '$.groupV2Change.from') IS $ourUuid;
      `).run({ourUuid:n}):t.info(`our UUID not found`)}function C(e){e.exec(`
    DROP INDEX   message_user_initiated;

    CREATE INDEX message_user_initiated ON messages (conversationId, isUserInitiatedMessage);
    `)}function ne(e){e.exec(`
    DROP INDEX messages_preview;

    -- Note the omitted 'expiresAt' column in the index. If it is present
    -- sqlite can't ORDER BY received_at, sent_at using this index.
    CREATE INDEX messages_preview ON messages
      (conversationId, shouldAffectPreview, isGroupLeaveEventFromOther, received_at, sent_at);
    `)}function re(e){e.exec(`
    DROP INDEX messages_unread;

    -- Note: here we move to the modern isStory/storyId fields and add received_at/sent_at.
    CREATE INDEX messages_unread ON messages
      (conversationId, readStatus, isStory, storyId, received_at, sent_at) WHERE readStatus IS NOT NULL;
    `)}n.m();function ie(e,t){let r=e.prepare(`DELETE FROM jobs WHERE queueType = $queueType`),i=_f(e,`reactions`);r.run({queueType:`reactions`});let a=e.prepare(`SELECT conversationId FROM messages WHERE id IS ?`);i.forEach(r=>{let{data:i,id:o}=r;if(!n.h(i)){t.warn(`reactions queue job ${o} was missing valid data`);return}let{messageId:s}=i;if(typeof s!=`string`){t.warn(`reactions queue job ${o} had a non-string messageId`);return}let c=a.get([s]);if(!c){t.warn(`Unable to find message for reaction job ${o}`);return}let{conversationId:l}=c;if(typeof l!=`string`){t.warn(`reactions queue job ${o} had a non-string conversationId`);return}X(e,{...r,queueType:`conversation`,data:{...i,type:`Reaction`,conversationId:l}})});let o=_f(e,`normal send`);r.run({queueType:`normal send`}),o.forEach(r=>{let{data:i,id:a}=r;if(!n.h(i)){t.warn(`normal send queue job ${a} was missing valid data`);return}X(e,{...r,queueType:`conversation`,data:{...i,type:`NormalMessage`}})})}function ae(e){e.exec(`
    -- Create indices that don't have storyId in them so that
    -- '_storyIdPredicate' could be optimized.

    -- See migration 47
    CREATE INDEX messages_conversation_no_story_id ON messages
      (conversationId, isStory, received_at, sent_at);

    -- See migration 50
    CREATE INDEX messages_unread_no_story_id ON messages
      (conversationId, readStatus, isStory, received_at, sent_at)
      WHERE readStatus IS NOT NULL;
    `)}t.cn();function oe(e,n){let r=e.prepare(`
      UPDATE conversations SET
        json = json_patch(json, $jsonPatch)
      WHERE id = $id;
    `),i=e=>{let t=e,i=`(${t.id}) groupv2(${t.groupId})`;if(!t.bannedMembersV2?.length)return!1;let a={bannedMembersV2:t.bannedMembersV2.map(e=>({uuid:e,timestamp:0}))};return n.info(`Updating ${i} with ${t.bannedMembersV2.length} banned members`),r.run({id:t.id,jsonPatch:JSON.stringify(a)}),!0},a=e.prepare(`
        SELECT json
        FROM conversations
        WHERE type = 'group'
        ORDER BY id ASC;
      `,{pluck:!0}).all().map(e=>t.ln(e));n.info(`About to iterate through ${a.length} conversations`);let o=0;for(let e of a)o+=+!!i(e);n.info(`Updated ${o} conversations`)}function se(e){e.exec(`
      ALTER TABLE unprocessed ADD COLUMN receivedAtCounter INTEGER;
    `)}n.m(),i.Cr();function ce(e,t){let r=e.prepare(`DELETE FROM jobs WHERE queueType = $queueType`),a=_f(e,`report spam`);r.run({queueType:`report spam`}),a.forEach(r=>{let{data:a,id:o}=r;if(!n.h(a)){t.warn(`report spam queue job ${o} was missing valid data`);return}let{e164:s,serverGuids:c}=a;if(typeof s!=`string`){t.warn(`report spam queue job ${o} had a non-string e164`);return}if(!i.Tr(c)){t.warn(`report spam queue job ${o} had a non-iterable serverGuids`);return}X(e,{...r,queueType:`report spam`,data:{uuid:s,serverGuids:c}})})}t.S(),i.T();function le(e){e.exec(`
    --- Add column to messages table

    ALTER TABLE messages ADD COLUMN seenStatus NUMBER default 0;

    --- Add index to make searching on this field easy

    CREATE INDEX messages_unseen_no_story ON messages
      (conversationId, seenStatus, isStory, received_at, sent_at)
      WHERE
        seenStatus IS NOT NULL;

    CREATE INDEX messages_unseen_with_story ON messages
      (conversationId, seenStatus, isStory, storyId, received_at, sent_at)
      WHERE
        seenStatus IS NOT NULL;

    --- Update seenStatus to UnseenStatus.Unseen for certain messages
    --- (NULL included because 'timer-notification' in 1:1 convos had type = NULL)

    UPDATE messages
      SET
        seenStatus = ${i.w.Unseen}
      WHERE
        readStatus = ${i.nt.Unread} AND
        (
          type IS NULL
          OR
          type IN (
            'call-history',
            'change-number-notification',
            'chat-session-refreshed',
            'delivery-issue',
            'group',
            'incoming',
            'keychange',
            'timer-notification',
            'verified-change'
          )
        );

    --- Set readStatus to ReadStatus.Read for all other message types

    UPDATE messages
      SET
        readStatus = ${i.nt.Read}
      WHERE
        readStatus = ${i.nt.Unread} AND
        type IS NOT NULL AND
        type NOT IN (
          'call-history',
          'change-number-notification',
          'chat-session-refreshed',
          'delivery-issue',
          'group',
          'incoming',
          'keychange',
          'timer-notification',
          'verified-change'
        );
    `)}function ue(e){e.exec(`
    DELETE FROM messages
    WHERE type IS 'message-history-unsynced';
    `)}i.rt(),i.T();function de(e){e.exec(`
    --- Promote unread status in JSON to SQL column

    -- NOTE: This was disabled because the 'unread' json field was deprecated
    -- in b0750e5f4e1f79f0f177b17cbe06d688431f948d, but the old value was kept
    -- in the messages created before the release of that commit.
    --
    -- UPDATE messages
    --   SET
    --     readStatus = ${i.nt.Unread},
    --     seenStatus = ${i.w.Unseen}
    --   WHERE
    --     json_extract(json, '$.unread') IS true OR
    --     json_extract(json, '$.unread') IS 1;

    --- Clean up all old messages that still have a null read status
    ---   Note: we don't need to update seenStatus, because that was defaulted to zero

    UPDATE messages
      SET
        readStatus = ${i.nt.Read}
      WHERE
        readStatus IS NULL;

    --- Re-run unseen/unread queries from migration 56

    UPDATE messages
      SET
        seenStatus = ${i.w.Unseen}
      WHERE
        readStatus = ${i.nt.Unread} AND
        (
          type IS NULL
          OR
          type IN (
            'call-history',
            'change-number-notification',
            'chat-session-refreshed',
            'delivery-issue',
            'group',
            'incoming',
            'keychange',
            'timer-notification',
            'verified-change'
          )
        );

    UPDATE messages
      SET
        readStatus = ${i.nt.Read}
      WHERE
        readStatus = ${i.nt.Unread} AND
        type IS NOT NULL AND
        type NOT IN (
          'call-history',
          'change-number-notification',
          'chat-session-refreshed',
          'delivery-issue',
          'group',
          'incoming',
          'keychange',
          'timer-notification',
          'verified-change'
        );

    --- (new) Ensure these message types are not unread, just unseen

    UPDATE messages
      SET
        readStatus = ${i.nt.Read}
      WHERE
        readStatus = ${i.nt.Unread} AND
        (
          type IN (
            'change-number-notification',
            'keychange'
          )
        );

    --- (new) Ensure that these message types are neither unseen nor unread

    UPDATE messages
      SET
        readStatus = ${i.nt.Read},
        seenStatus = ${i.w.Seen}
      WHERE
        type IN (
          'group-v1-migration',
          'message-history-unsynced',
          'outgoing',
          'profile-change',
          'universal-timer-notification'
        );

    --- Make sure JSON reflects SQL columns

    UPDATE messages
      SET
        json = json_patch(
          json,
          json_object(
            'readStatus', readStatus,
            'seenStatus', seenStatus
          )
        )
      WHERE
        readStatus IS NOT NULL OR
        seenStatus IS NOT 0;
    `)}function fe(e){e.exec(`
      CREATE INDEX unprocessed_byReceivedAtCounter ON unprocessed
        (receivedAtCounter)
    `)}function w(e){e.exec(`
    DROP INDEX expiring_message_by_conversation_and_received_at;

    CREATE INDEX expiring_message_by_conversation_and_received_at
      ON messages
      (
        conversationId,
        storyId,
        expirationStartTimestamp,
        expireTimer,
        received_at
      )
      WHERE isStory IS 0 AND type IS 'incoming';
    `)}function pe(e){e.exec(`
    ALTER TABLE storyDistributions DROP COLUMN avatarKey;
    ALTER TABLE storyDistributions DROP COLUMN avatarUrlPath;

    ALTER TABLE storyDistributions ADD COLUMN deletedAtTimestamp INTEGER;
    ALTER TABLE storyDistributions ADD COLUMN allowsReplies INTEGER;
    ALTER TABLE storyDistributions ADD COLUMN isBlockList INTEGER;

    ALTER TABLE storyDistributions ADD COLUMN storageID STRING;
    ALTER TABLE storyDistributions ADD COLUMN storageVersion INTEGER;
    ALTER TABLE storyDistributions ADD COLUMN storageUnknownFields BLOB;
    ALTER TABLE storyDistributions ADD COLUMN storageNeedsSync INTEGER;

    ALTER TABLE messages ADD COLUMN storyDistributionListId STRING;

    CREATE INDEX messages_by_distribution_list
      ON messages(storyDistributionListId, received_at)
      WHERE storyDistributionListId IS NOT NULL;
    `)}function me(e){e.exec(`
    ALTER TABLE sendLogPayloads ADD COLUMN urgent INTEGER;
    `)}function he(e){e.exec(`
    ALTER TABLE unprocessed ADD COLUMN urgent INTEGER;
    `)}function ge(e){e.exec(`
    ALTER TABLE preKeys
      ADD COLUMN ourUuid STRING
      GENERATED ALWAYS AS (json_extract(json, '$.ourUuid'));

    CREATE INDEX preKeys_ourUuid ON preKeys (ourUuid);

    ALTER TABLE signedPreKeys
      ADD COLUMN ourUuid STRING
      GENERATED ALWAYS AS (json_extract(json, '$.ourUuid'));

    CREATE INDEX signedPreKeys_ourUuid ON signedPreKeys (ourUuid);
    `)}function _e(e){e.exec(`
    ALTER TABLE sticker_packs ADD COLUMN position INTEGER DEFAULT 0 NOT NULL;
    ALTER TABLE sticker_packs ADD COLUMN storageID STRING;
    ALTER TABLE sticker_packs ADD COLUMN storageVersion INTEGER;
    ALTER TABLE sticker_packs ADD COLUMN storageUnknownFields BLOB;
    ALTER TABLE sticker_packs
    ADD COLUMN storageNeedsSync
    INTEGER DEFAULT 0 NOT NULL;

    CREATE TABLE uninstalled_sticker_packs (
      id STRING NOT NULL PRIMARY KEY,
      uninstalledAt NUMBER NOT NULL,
      storageID STRING,
      storageVersion NUMBER,
      storageUnknownFields BLOB,
      storageNeedsSync INTEGER NOT NULL
    );

    -- Set initial position

    UPDATE sticker_packs
    SET
      position = (row_number - 1),
      storageNeedsSync = 1
    FROM (
      SELECT id, row_number() OVER (ORDER BY lastUsed DESC) as row_number
      FROM sticker_packs
    ) as ordered_pairs
    WHERE sticker_packs.id IS ordered_pairs.id;

    -- See: getAllStickerPacks

    CREATE INDEX sticker_packs_by_position_and_id ON sticker_packs (
      position ASC,
      id ASC
    );
    `)}function ve(e){e.exec(`
    ALTER TABLE sendLogPayloads
    ADD COLUMN hasPniSignatureMessage INTEGER DEFAULT 0 NOT NULL;
    `)}function ye(e){e.exec(`
    ALTER TABLE unprocessed ADD COLUMN story INTEGER;
    `)}function be(e){e.exec(`
    ALTER TABLE messages
      DROP COLUMN deprecatedSourceDevice;
    ALTER TABLE unprocessed
      DROP COLUMN deprecatedSourceDevice;
    `)}function xe(e){e.exec(`
    DROP TABLE IF EXISTS groupCallRings;

    CREATE TABLE groupCallRingCancellations(
      ringId INTEGER PRIMARY KEY,
      createdAt INTEGER NOT NULL
    );
    `)}function Se(e){e.exec(`
    CREATE INDEX messages_by_storyId ON messages (storyId);
    `)}function Ce(e){e.exec(`
    --- These will be re-added below
    DROP INDEX messages_preview;
    DROP INDEX messages_activity;
    DROP INDEX message_user_initiated;

    --- These will also be re-added below
    ALTER TABLE messages DROP COLUMN shouldAffectActivity;
    ALTER TABLE messages DROP COLUMN shouldAffectPreview;
    ALTER TABLE messages DROP COLUMN isUserInitiatedMessage;

    --- Note: These generated columns were originally introduced in migration 47, and
    ---       are mostly the same
    
    --- Based on the current list (model-types.ts), the types which DO affect activity:
    ---   NULL (old, malformed data)
    ---   call-history
    ---   chat-session-refreshed (deprecated)
    ---   delivery-issue
    ---   group (deprecated)
    ---   group-v2-change
    ---   incoming
    ---   outgoing
    ---   timer-notification

    --- (change: added conversation-merge, keychange, and phone-number-discovery)
    ALTER TABLE messages
      ADD COLUMN shouldAffectActivity INTEGER
      GENERATED ALWAYS AS (
        type IS NULL
        OR
        type NOT IN (
          'change-number-notification',
          'conversation-merge',
          'group-v1-migration',
          'keychange',
          'message-history-unsynced',
          'phone-number-discovery',
          'profile-change',
          'story',
          'universal-timer-notification',
          'verified-change'
        )
      );

    --- (change: added conversation-merge and phone-number-discovery
    ---    (now matches the above list)
    ALTER TABLE messages
      ADD COLUMN shouldAffectPreview INTEGER
      GENERATED ALWAYS AS (
        type IS NULL
        OR
        type NOT IN (
          'change-number-notification',
          'conversation-merge',
          'group-v1-migration',
          'keychange',
          'message-history-unsynced',
          'phone-number-discovery',
          'profile-change',
          'story',
          'universal-timer-notification',
          'verified-change'
        )
      );

    --- Note: This list only differs from the above on these types:
    ---   group-v2-change

    --- (change: added conversation-merge and phone-number-discovery
    ALTER TABLE messages
      ADD COLUMN isUserInitiatedMessage INTEGER
      GENERATED ALWAYS AS (
        type IS NULL
        OR
        type NOT IN (
          'change-number-notification',
          'conversation-merge',
          'group-v1-migration',
          'group-v2-change',
          'keychange',
          'message-history-unsynced',
          'phone-number-discovery',
          'profile-change',
          'story',
          'universal-timer-notification',
          'verified-change'
        )
      );

    CREATE INDEX messages_preview ON messages
      (conversationId, shouldAffectPreview, isGroupLeaveEventFromOther, expiresAt, received_at, sent_at);

    CREATE INDEX messages_activity ON messages
      (conversationId, shouldAffectActivity, isTimerChangeFromSync, isGroupLeaveEventFromOther, received_at, sent_at);

    CREATE INDEX message_user_initiated ON messages (isUserInitiatedMessage);
    `)}function we(e){e.exec(`
    ALTER TABLE messages
      ADD COLUMN callId TEXT
      GENERATED ALWAYS AS (
        json_extract(json, '$.callHistoryDetails.callId')
      );
    ALTER TABLE messages
      ADD COLUMN callMode TEXT
      GENERATED ALWAYS AS (
        json_extract(json, '$.callHistoryDetails.callMode')
      );
    CREATE INDEX messages_call ON messages
      (conversationId, type, callMode, callId);
    `)}function Te(e){e.exec(`
    --- Delete deprecated notifications
    DELETE FROM messages WHERE type IS 'phone-number-discovery';

    --- These will be re-added below
    DROP INDEX messages_preview;
    DROP INDEX messages_activity;
    DROP INDEX message_user_initiated;

    --- These will also be re-added below
    ALTER TABLE messages DROP COLUMN shouldAffectActivity;
    ALTER TABLE messages DROP COLUMN shouldAffectPreview;
    ALTER TABLE messages DROP COLUMN isUserInitiatedMessage;

    --- Note: These generated columns were originally introduced in migration 71, and
    ---       are mostly the same

    --- (change: removed phone-number-discovery)
    ALTER TABLE messages
      ADD COLUMN shouldAffectActivity INTEGER
      GENERATED ALWAYS AS (
        type IS NULL
        OR
        type NOT IN (
          'change-number-notification',
          'conversation-merge',
          'group-v1-migration',
          'keychange',
          'message-history-unsynced',
          'profile-change',
          'story',
          'universal-timer-notification',
          'verified-change'
        )
      );

    --- (change: removed phone-number-discovery
    ---    (now matches the above list)
    ALTER TABLE messages
      ADD COLUMN shouldAffectPreview INTEGER
      GENERATED ALWAYS AS (
        type IS NULL
        OR
        type NOT IN (
          'change-number-notification',
          'conversation-merge',
          'group-v1-migration',
          'keychange',
          'message-history-unsynced',
          'profile-change',
          'story',
          'universal-timer-notification',
          'verified-change'
        )
      );

    --- Note: This list only differs from the above on these types:
    ---   group-v2-change

    --- (change: removed phone-number-discovery
    ALTER TABLE messages
      ADD COLUMN isUserInitiatedMessage INTEGER
      GENERATED ALWAYS AS (
        type IS NULL
        OR
        type NOT IN (
          'change-number-notification',
          'conversation-merge',
          'group-v1-migration',
          'group-v2-change',
          'keychange',
          'message-history-unsynced',
          'profile-change',
          'story',
          'universal-timer-notification',
          'verified-change'
        )
      );

    CREATE INDEX messages_preview ON messages
      (conversationId, shouldAffectPreview, isGroupLeaveEventFromOther, expiresAt, received_at, sent_at);

    CREATE INDEX messages_activity ON messages
      (conversationId, shouldAffectActivity, isTimerChangeFromSync, isGroupLeaveEventFromOther, received_at, sent_at);

    CREATE INDEX message_user_initiated ON messages (isUserInitiatedMessage);
    `)}function Ee(e){e.exec(`
    -- Previously: (isUserInitiatedMessage)
    DROP INDEX message_user_initiated;

    CREATE INDEX message_user_initiated ON messages (conversationId, isUserInitiatedMessage);

    -- Previously: (unread, conversationId)
    DROP INDEX reactions_unread;

    CREATE INDEX reactions_unread ON reactions (
      conversationId,
      unread
    );
    `)}function De(){}function Oe(e){e.exec(`
    -- Re-created below
    DROP INDEX IF EXISTS message_expires_at;
    DROP INDEX IF EXISTS messages_preview;

    -- Create non-null expiresAt column
    ALTER TABLE messages
      DROP COLUMN expiresAt;

    ALTER TABLE messages
      ADD COLUMN
      expiresAt INT
      GENERATED ALWAYS
      AS (ifnull(
        expirationStartTimestamp + (expireTimer * 1000),
        ${2**53-1}
      ));

    -- Re-create indexes
    -- Note the "s" at the end of "messages"
    CREATE INDEX messages_expires_at ON messages (
      expiresAt
    );

    -- Note that expiresAt is intentionally dropped from the index since
    -- expiresAt > $now is likely to be true so we just try selecting it
    -- *after* ordering by received_at/sent_at.
    CREATE INDEX messages_preview ON messages
      (conversationId, shouldAffectPreview, isGroupLeaveEventFromOther,
       received_at, sent_at);
    CREATE INDEX messages_preview_without_story ON messages
      (conversationId, shouldAffectPreview, isGroupLeaveEventFromOther,
       received_at, sent_at) WHERE storyId IS NULL;
    `)}function ke(e){e.exec(`
    -- Create FTS table with custom tokenizer from
    -- @signalapp/sqlcipher.

    DROP TABLE messages_fts;

    CREATE VIRTUAL TABLE messages_fts USING fts5(
      body,
      tokenize = 'signal_tokenizer'
    );

    -- Reindex messages
    -- Based on messages_on_insert trigger from migrations/45-stories.ts

    INSERT INTO messages_fts (rowid, body)
    SELECT rowid, body
    FROM messages
    WHERE isViewOnce IS NOT 1 AND storyId IS NULL;
    `)}n.m();function Ae(e,t){let r=e.prepare(`DELETE FROM jobs WHERE queueType = $queueType`),i=[{queueType:`delivery receipts`,jobDataKey:`deliveryReceipts`,jobDataIsArray:!0,newReceiptsType:`deliveryReceipt`},{queueType:`read receipts`,jobDataKey:`readReceipts`,jobDataIsArray:!0,newReceiptsType:`readReceipt`},{queueType:`viewed receipts`,jobDataKey:`viewedReceipt`,jobDataIsArray:!1,newReceiptsType:`viewedReceipt`}],a=e.prepare(`SELECT conversationId FROM messages WHERE id IS ?`);for(let o of i){let i=_f(e,o.queueType);r.run({queueType:o.queueType}),i.forEach(r=>{let{data:i,id:s}=r;if(!n.h(i)){t.warn(`${o.queueType} queue job ${s} was missing valid data`);return}let{messageId:c}=i;if(typeof c!=`string`){t.warn(`${o.queueType} queue job ${s} had a non-string messageId`);return}let l=a.get([c]);if(!l){t.warn(`Unable to find message for ${o.queueType} job ${s}`);return}let{conversationId:u}=l;if(typeof u!=`string`){t.warn(`${o.queueType} queue job ${s} had a non-string conversationId`);return}let d=o.jobDataIsArray?i[o.jobDataKey]:[i[o.jobDataKey]];if(!Array.isArray(d)){t.warn(`${o.queueType} queue job ${s} had a non-array ${o.jobDataKey}`);return}let f=[];for(let e of d){if(!n.h(e)){t.warn(`${o.queueType} queue job ${s} had a non-record receipt`);continue}f.push({...e,conversationId:u})}X(e,{...r,queueType:`conversation`,data:{type:`Receipts`,conversationId:u,receiptsType:o.newReceiptsType,receipts:f}})})}}function je(e){e.exec(`
    DROP INDEX   messages_hasVisualMediaAttachments;
    CREATE INDEX messages_hasVisualMediaAttachments
      ON messages (
        conversationId, isStory, storyId,
        hasVisualMediaAttachments, received_at, sent_at
      )
      WHERE hasVisualMediaAttachments IS 1;
  `)}function Me(e){e.exec(`
    CREATE TABLE edited_messages(
      fromId STRING,
      messageId STRING REFERENCES messages(id)
        ON DELETE CASCADE,
      sentAt INTEGER,
      readStatus INTEGER
    );

    CREATE INDEX edited_messages_sent_at ON edited_messages (sentAt);
  `)}function Ne(e){e.exec(`
    --- These will be re-added below
    DROP INDEX messages_preview;
    DROP INDEX messages_preview_without_story;
    DROP INDEX messages_activity;
    DROP INDEX message_user_initiated;

    --- These will also be re-added below
    ALTER TABLE messages DROP COLUMN shouldAffectActivity;
    ALTER TABLE messages DROP COLUMN shouldAffectPreview;
    ALTER TABLE messages DROP COLUMN isUserInitiatedMessage;

    --- Note: These generated columns were previously modified in
    ---       migration 73, and are mostly the same

    --- (change: added contact-removed-notification)
    ALTER TABLE messages
      ADD COLUMN shouldAffectActivity INTEGER
      GENERATED ALWAYS AS (
        type IS NULL
        OR
        type NOT IN (
          'change-number-notification',
          'contact-removed-notification',
          'conversation-merge',
          'group-v1-migration',
          'keychange',
          'message-history-unsynced',
          'profile-change',
          'story',
          'universal-timer-notification',
          'verified-change'
        )
      );

    --- (change: added contact-removed-notification)
    ALTER TABLE messages
      ADD COLUMN shouldAffectPreview INTEGER
      GENERATED ALWAYS AS (
        type IS NULL
        OR
        type NOT IN (
          'change-number-notification',
          'contact-removed-notification',
          'conversation-merge',
          'group-v1-migration',
          'keychange',
          'message-history-unsynced',
          'profile-change',
          'story',
          'universal-timer-notification',
          'verified-change'
        )
      );

    --- (change: added contact-removed-notification)
    ALTER TABLE messages
      ADD COLUMN isUserInitiatedMessage INTEGER
      GENERATED ALWAYS AS (
        type IS NULL
        OR
        type NOT IN (
          'change-number-notification',
          'contact-removed-notification',
          'conversation-merge',
          'group-v1-migration',
          'group-v2-change',
          'keychange',
          'message-history-unsynced',
          'profile-change',
          'story',
          'universal-timer-notification',
          'verified-change'
        )
      );

    --- From migration 76
    CREATE INDEX messages_preview ON messages
      (conversationId, shouldAffectPreview, isGroupLeaveEventFromOther,
       received_at, sent_at);

    --- From migration 76
    CREATE INDEX messages_preview_without_story ON messages
      (conversationId, shouldAffectPreview, isGroupLeaveEventFromOther,
       received_at, sent_at) WHERE storyId IS NULL;

    --- From migration 73
    CREATE INDEX messages_activity ON messages
      (conversationId, shouldAffectActivity, isTimerChangeFromSync, isGroupLeaveEventFromOther, received_at, sent_at);

    --- From migration 74
    CREATE INDEX message_user_initiated ON messages (conversationId, isUserInitiatedMessage);
    `)}function Pe(e){e.exec(`
    ALTER TABLE edited_messages DROP COLUMN fromId;
    ALTER TABLE edited_messages ADD COLUMN conversationId STRING;

    CREATE INDEX edited_messages_unread ON edited_messages (readStatus, conversationId);
  `)}function Fe(e){e.exec(`
    ALTER TABLE messages
      ADD COLUMN mentionsMe INTEGER NOT NULL DEFAULT 0;

    -- one which includes story data...
    CREATE INDEX messages_unread_mentions ON messages
      (conversationId, readStatus, mentionsMe, isStory, storyId, received_at, sent_at)
      WHERE readStatus IS NOT NULL;

    -- ...and one which doesn't, so storyPredicate works as expected
    CREATE INDEX messages_unread_mentions_no_story_id ON messages
      (conversationId, readStatus, mentionsMe, isStory, received_at, sent_at)
      WHERE isStory IS 0 AND readStatus IS NOT NULL;
    `)}function Ie(e){let t=`
    SELECT messages.id, bodyRanges.value ->> 'mentionUuid' as mentionUuid, bodyRanges.value ->> 'start' as start, bodyRanges.value ->> 'length' as length 
    FROM messages, json_each(messages.json ->> 'bodyRanges') as bodyRanges
    WHERE bodyRanges.value ->> 'mentionUuid' IS NOT NULL
  `;e.exec(`
    DROP TABLE IF EXISTS mentions;

    CREATE TABLE mentions (
      messageId REFERENCES messages(id) ON DELETE CASCADE,
      mentionUuid STRING,
      start INTEGER,
      length INTEGER
    );

    CREATE INDEX mentions_uuid ON mentions (mentionUuid);

    INSERT INTO mentions (messageId, mentionUuid, start, length)
    ${t};

    -- Note: any changes to this trigger must be reflected in 
    -- Server.ts: enableMessageInsertTriggersAndBackfill
    CREATE TRIGGER messages_on_insert_insert_mentions AFTER INSERT ON messages
    BEGIN
      INSERT INTO mentions (messageId, mentionUuid, start, length)
      ${t} 
      AND messages.id = new.id;
    END;

    CREATE TRIGGER messages_on_update_update_mentions AFTER UPDATE ON messages
    BEGIN
      DELETE FROM mentions WHERE messageId = new.id;
      INSERT INTO mentions (messageId, mentionUuid, start, length)
      ${t} 
      AND messages.id = new.id;
    END;
  `)}function Le(e){e.exec(`CREATE TABLE kyberPreKeys(
      id STRING PRIMARY KEY NOT NULL,
      json TEXT NOT NULL,
      ourUuid STRING
        GENERATED ALWAYS AS (json_extract(json, '$.ourUuid'))
    );`),e.exec(`CREATE INDEX kyberPreKeys_ourUuid ON kyberPreKeys (ourUuid);`);let t=Date.now();e.exec(`UPDATE preKeys SET
      json = json_set(json, '$.createdAt', ${t});
    `)}function Re(e){e.exec(`CREATE INDEX messages_story_replies
      ON messages (storyId, received_at, sent_at)
      WHERE isStory IS 0;
    `)}t.cn();function ze(e,n){return Be(e,n,`kyberPreKeys`,t.gn`kyberPreKeys`,t.gn`createdAt`,t.gn`ourServiceId`),Be(e,n,`signedPreKeys`,t.gn`signedPreKeys`,t.gn`created_at`,t.gn`ourServiceId`),n.info(`Done with deletions, starting vacuum...`),`vacuum`}function Be(e,n,r,a,o,s){let c,l=e.prepare(`SELECT json FROM items WHERE id IS 'pni'`,{pluck:!0}).get();try{c=i.Ur(JSON.parse(l??``).value,r)}catch(e){l?n.warn(`${r}: PNI found but did not parse`,t.Aa(e)):n.info(`${r}: Our PNI not found`);return}let u=e.prepare(t.mn`SELECT count(*) FROM ${a};`[0],{pluck:!0}).get()??0;if(n.info(`${r}: Found ${u} total keys`),u<1e3)return;let[d,f]=t.mn`SELECT count(*) from ${a} WHERE ${s} = ${c}`,p=e.prepare(d,{pluck:!0}).get(f);n.info(`${r}: Found ${p} keys for PNI`),e.exec(t.mn`
      ALTER TABLE ${a}
        ADD COLUMN createdAt NUMBER
          GENERATED ALWAYS AS (json_extract(json, '$.${o}'));

      CREATE INDEX ${a}_date
        ON ${a} (${s}, createdAt);
    `[0]),n.info(`${r}: Temporary index created`);let[m,h]=t.mn`
    SELECT createdAt
    FROM ${a}
    WHERE
      createdAt IS NOT NULL AND
      ${s} = ${c}
    ORDER BY createdAt ASC
    LIMIT 1
    OFFSET 499
  `,g=e.prepare(m,{pluck:!0}).get(h);n.info(`${r}: Found 500th-oldest timestamp: ${g}`);let[_,v]=t.mn`
    SELECT createdAt
    FROM ${a}
    WHERE
      createdAt IS NOT NULL AND
      ${s} = ${c}
    ORDER BY createdAt DESC
    LIMIT 1
    OFFSET 499
  `,y=e.prepare(_,{pluck:!0}).get(v);n.info(`${r}: Found 500th-newest timestamp: ${y}`);let b,[x,S]=t.mn`
    DELETE FROM ${a}
    WHERE
      createdAt IS NOT NULL AND
      createdAt > ${g??null} AND
      createdAt < ${y??null} AND
      ${s} = ${c}
    LIMIT 10000;
  `,ee=e.prepare(x);do b=ee.run(S),n.info(`${r}: Deleted ${b.changes} keys`);while(b.changes>0);n.info(`${r}: Delete is complete!`);let[te,C]=t.mn`
    SELECT count(*)
    FROM ${a}
    WHERE ${s} = ${c};
  `,ne=e.prepare(te,{pluck:!0}).get(C);n.info(`${r}: Found ${ne} keys for PNI after delete`),e.exec(t.mn`
      DROP INDEX ${a}_date;
      ALTER TABLE ${a} DROP COLUMN createdAt;
    `[0])}t.cn();function Ve(e,n,r){r>=88||(Be(e,n,`(cleanup)/kyberPreKeys`,t.gn`kyberPreKeys`,t.gn`createdAt`,t.gn`ourUuid`),Be(e,n,`(cleanup)/preKeys`,t.gn`preKeys`,t.gn`createdAt`,t.gn`ourUuid`),Be(e,n,`(cleanup)/signedPreKeys`,t.gn`signedPreKeys`,t.gn`created_at`,t.gn`ourUuid`))}i.zr(),i.$n(),t.ga();const{omit:T}=m.default;function He(e,t){let n=`
    SELECT messages.id, bodyRanges.value ->> 'mentionAci' as mentionAci,
      bodyRanges.value ->> 'start' as start,
      bodyRanges.value ->> 'length' as length
    FROM messages, json_each(messages.json ->> 'bodyRanges') as bodyRanges
    WHERE bodyRanges.value ->> 'mentionAci' IS NOT NULL
  `;e.exec(`
    --
    -- conversations
    --

    DROP INDEX conversations_uuid;

    ALTER TABLE conversations
      RENAME COLUMN uuid TO serviceId;

    -- See: updateToSchemaVersion20
    CREATE INDEX conversations_serviceId ON conversations(serviceId);

    --
    -- sessions
    --

    ALTER TABLE sessions
      RENAME COLUMN ourUuid TO ourServiceId;
    ALTER TABLE sessions
      RENAME COLUMN uuid TO serviceId;

    --
    -- messages
    --

    DROP INDEX messages_sourceUuid;
    DROP INDEX messages_preview;
    DROP INDEX messages_preview_without_story;
    DROP INDEX messages_activity;

    ALTER TABLE messages
      DROP COLUMN isGroupLeaveEventFromOther;
    ALTER TABLE messages
      DROP COLUMN isGroupLeaveEvent;

    ALTER TABLE messages
      RENAME COLUMN sourceUuid TO sourceServiceId;

    -- See: updateToSchemaVersion47
    ALTER TABLE messages
      ADD COLUMN isGroupLeaveEvent INTEGER
      GENERATED ALWAYS AS (
        type IS 'group-v2-change' AND
        json_array_length(json_extract(json, '$.groupV2Change.details')) IS 1 AND
        json_extract(json, '$.groupV2Change.details[0].type') IS 'member-remove' AND
        json_extract(json, '$.groupV2Change.from') IS NOT NULL AND
        json_extract(json, '$.groupV2Change.from') IS json_extract(json, '$.groupV2Change.details[0].aci')
      );

    ALTER TABLE messages
      ADD COLUMN isGroupLeaveEventFromOther INTEGER
      GENERATED ALWAYS AS (
        isGroupLeaveEvent IS 1
        AND
        isChangeCreatedByUs IS 0
      );

    -- See: updateToSchemaVersion25
    CREATE INDEX messages_sourceServiceId on messages(sourceServiceId);

    -- See: updateToSchemaVersion81
    CREATE INDEX messages_preview ON messages
      (conversationId, shouldAffectPreview, isGroupLeaveEventFromOther,
       received_at, sent_at);
    CREATE INDEX messages_preview_without_story ON messages
      (conversationId, shouldAffectPreview, isGroupLeaveEventFromOther,
       received_at, sent_at) WHERE storyId IS NULL;
    CREATE INDEX messages_activity ON messages
      (conversationId, shouldAffectActivity, isTimerChangeFromSync,
       isGroupLeaveEventFromOther, received_at, sent_at);

    --
    -- reactions
    --

    DROP INDEX reaction_identifier;

    ALTER TABLE reactions
      RENAME COLUMN targetAuthorUuid TO targetAuthorAci;

    -- See: updateToSchemaVersion29
    CREATE INDEX reaction_identifier ON reactions (
      emoji,
      targetAuthorAci,
      targetTimestamp
    );

    --
    -- unprocessed
    --

    ALTER TABLE unprocessed
      RENAME COLUMN sourceUuid TO sourceServiceId;

    --
    -- sendLogRecipients
    --

    DROP INDEX sendLogRecipientsByRecipient;

    ALTER TABLE sendLogRecipients
      RENAME COLUMN recipientUuid TO recipientServiceId;

    -- See: updateToSchemaVersion37
    CREATE INDEX sendLogRecipientsByRecipient
      ON sendLogRecipients (recipientServiceId, deviceId);

    --
    -- storyDistributionMembers
    --

    ALTER TABLE storyDistributionMembers
      RENAME COLUMN uuid TO serviceId;

    --
    -- mentions
    --

    DROP TRIGGER messages_on_update;
    DROP TRIGGER messages_on_insert_insert_mentions;
    DROP TRIGGER messages_on_update_update_mentions;
    DROP INDEX mentions_uuid;

    ALTER TABLE mentions
      RENAME COLUMN mentionUuid TO mentionAci;

    -- See: updateToSchemaVersion84
    CREATE INDEX mentions_aci ON mentions (mentionAci);

    --
    -- preKeys
    --

    DROP INDEX preKeys_ourUuid;
    DROP INDEX signedPreKeys_ourUuid;
    DROP INDEX kyberPreKeys_ourUuid;

    ALTER TABLE preKeys
      RENAME COLUMN ourUuid TO ourServiceId;
    ALTER TABLE signedPreKeys
      RENAME COLUMN ourUuid TO ourServiceId;
    ALTER TABLE kyberPreKeys
      RENAME COLUMN ourUuid TO ourServiceId;

    -- See: updateToSchemaVersion64
    CREATE INDEX preKeys_ourServiceId ON preKeys (ourServiceId);
    CREATE INDEX signedPreKeys_ourServiceId ON signedPreKeys (ourServiceId);
    CREATE INDEX kyberPreKeys_ourServiceId ON kyberPreKeys (ourServiceId);
  `);let{identifierToServiceId:r}=Ue(e,t),i=We(e,t);Ge(e,i,t),Ke(e,t),qe(e,`preKeys`,i,t),qe(e,`signedPreKeys`,i,t),qe(e,`kyberPreKeys`,i,t),Je(e,r,t),e.exec(`
    -- See: updateToSchemaVersion45
    CREATE TRIGGER messages_on_update AFTER UPDATE ON messages
    WHEN
      (new.body IS NULL OR old.body IS NOT new.body) AND
       new.isViewOnce IS NOT 1 AND new.storyId IS NULL
    BEGIN
      DELETE FROM messages_fts WHERE rowid = old.rowid;
      INSERT INTO messages_fts
        (rowid, body)
      VALUES
        (new.rowid, new.body);
    END;

    -- See: updateToSchemaVersion84
    CREATE TRIGGER messages_on_insert_insert_mentions AFTER INSERT ON messages
    BEGIN
      INSERT INTO mentions (messageId, mentionAci, start, length)
      ${n}
      AND messages.id = new.id;
    END;

    CREATE TRIGGER messages_on_update_update_mentions AFTER UPDATE ON messages
    BEGIN
      DELETE FROM mentions WHERE messageId = new.id;
      INSERT INTO mentions (messageId, mentionAci, start, length)
      ${n}
      AND messages.id = new.id;
    END;
  `)}function Ue(e,n){let r=e.prepare(`SELECT id, e164, serviceId, json FROM conversations`).all(),a=e.prepare(`UPDATE conversations SET json = $json WHERE id IS $id`);n.info(`updating ${r.length} conversations`);let o=new Map;for(let{id:e,e164:t,serviceId:a}of r){if(!a)continue;let r=i.Wr(a,`legacyConvo.serviceId`,n);o.set(e,r),t&&o.set(t,r),o.set(r,r)}for(let{id:e,json:s}of r)try{let{uuid:r,pni:c,bannedMembersV2:l,membersV2:u,pendingAdminApprovalV2:d,pendingMembersV2:f,lastMessageBodyRanges:p,senderKeyInfo:m,...h}=JSON.parse(s),g={...h,serviceId:i.Wr(r,`legacyConvo.serviceId`,n),pni:Ze(c,`legacyConvo.pni`,n),bannedMembersV2:l?.map(({uuid:e,...t})=>({...t,serviceId:i.Wr(e,`legacyConvo.bannedMembersV2`,n)})),membersV2:u?.map(({uuid:e,...t})=>({...t,aci:i.er(e,`legacyConvo.membersV2`,n)})),pendingAdminApprovalV2:d?.map(({uuid:e,...t})=>({...t,aci:i.er(e,`legacyConvo.pendingAdminApprovalV2`,n)})),pendingMembersV2:f?.map(({uuid:e,...t})=>({...t,serviceId:i.Wr(e,`legacyConvo.pendingMembersV2`,n)})),lastMessageBodyRanges:Qe(p,`lastMessageBodyRanges`,n),senderKeyInfo:m?{...m,memberDevices:m.memberDevices.map(({identifier:e,...t})=>{let r=o.get(e);if(!r){n.warn(`failed to resolve identifier ${e}`);return}return{...t,serviceId:r}}).filter(t._a)}:void 0};a.run({id:e,json:JSON.stringify(g)})}catch(t){n.warn(`failed to parse convo ${e} json`,t);continue}return{identifierToServiceId:o}}function We(e,t){let n=e.prepare(`
    SELECT json
    FROM items
    WHERE id IS 'uuid_id'
  `,{pluck:!0}).get(),r=e.prepare(`
    SELECT json
    FROM items
    WHERE id IS 'pni'
  `,{pluck:!0}).get(),a;try{[a]=JSON.parse(n??``).value.split(`.`,2)}catch(e){n?t.warn(`failed to parse uuid_id item`,e):t.info(`Our UUID not found`)}let o;try{o=JSON.parse(r??``).value}catch(e){r?t.warn(`failed to parse pni item`,e):t.info(`Our PNI not found`)}let s=i.er(a,`uuid_id`,t),c=Ze(o,`pni`,t),l=e.prepare(`
      SELECT id, json
      FROM items
      WHERE id IN ('identityKeyMap', 'registrationIdMap');
    `).all(),u=e.prepare(`UPDATE items SET json = $json WHERE id IS $id`);c&&u.run({id:`pni`,json:JSON.stringify({id:`pni`,value:c})});for(let{id:e,json:n}of l)try{let t=JSON.parse(n),r=a&&t.value[a];a&&s&&r&&(delete t.value[a],t.value[s]=r);let i=o&&t.value[o];o&&c&&i&&(delete t.value[o],t.value[c]=i),u.run({id:e,json:JSON.stringify(t)})}catch(n){t.warn(`failed to parse ${e} item`,n)}return{aci:s,pni:c,legacyAci:a,legacyPni:o}}function Ge(e,t,n){let r=e.prepare(`SELECT id, serviceId, ourServiceId, json FROM sessions`).all(),i=e.prepare(`
      UPDATE sessions
      SET id = $newId, serviceId = $newServiceId,
        ourServiceId = $newOurServiceId, json = $newJson
      WHERE id IS $id
    `);n.info(`updating ${r.length} sessions`);for(let{id:e,serviceId:a,ourServiceId:o,json:s}of r){let r=e.match(/^(.*):(.*)\.(.*)$/);if(!r){n.warn(`invalid session id ${e}`);continue}let c;try{c=JSON.parse(s)}catch(t){n.warn(`failed to parse session ${e}`,t);continue}let[,l,u,d]=r,f=`${Xe(l,t,n)}:${Xe(u,t,n)}.${d}`,p=Xe(a,t,n),m=Xe(o,t,n);if(!p||!m){n.warn(`failed to normalize session service ids`,a,o);continue}let h={...T(c,`uuid`,`ourUuid`),id:f,serviceId:p,ourServiceId:m};i.run({id:e,newId:f,newServiceId:p,newOurServiceId:m,newJson:JSON.stringify(h)})}}function Ke(e,t){let n=1e4,r=e.prepare(`
    SELECT rowid, id, json
    FROM messages
    LIMIT $limit
    OFFSET $offset
  `),a=e.prepare(`
    UPDATE messages
    SET json = $json
    WHERE rowid = $rowid
  `);t.info(`updating messages`);let o=0;for(let e=0;;e+=n){let s=r.all({limit:n,offset:e});if(s.length===0)break;o+=s.length;for(let{rowid:e,id:n,json:r}of s)try{let n=JSON.parse(r),{sourceUuid:o,expirationTimerUpdate:s,reactions:c,storyReaction:l,storyReplyContext:u,editHistory:d,groupV2Change:f,...p}=n,m={...p,...T(Ye(n,`message`,t),`sourceUuid`),sourceServiceId:i.Wr(o,`sourceUuid`),expirationTimerUpdate:s?{...T(s,`sourceUuid`),sourceServiceId:i.Wr(s.sourceUuid,`expirationTimerUpdate.sourceUuid`)}:void 0,reactions:c?.map(e=>$e(e)),storyReaction:l?$e(l):void 0,storyReplyContext:u?{...T(u,`authorUuid`),authorAci:i.er(u.authorUuid,`storyReplyContext.authorUuid`,t)}:void 0,editHistory:d?.map(e=>Ye(e,`editHistory`,t)),groupV2Change:f?{...f,details:f.details?.map(e=>tt(e,t))}:void 0};a.run({rowid:e,json:JSON.stringify(m)})}catch(e){t.warn(`failed to parse message ${n} json`,e)}}t.info(`updated ${o} messages`)}function qe(e,t,n,r){let i=e.prepare(`SELECT id, json FROM ${t}`).all(),a=e.prepare(`
    UPDATE ${t}
    SET id = $newId, json = $newJson
    WHERE id = $id
  `);r.info(`updating ${i.length} ${t}`);for(let{id:e,json:o}of i){let i=e.match(/^(.*):(.*)$/);if(!i){r.warn(`invalid ${t} id ${e}`);continue}let s;try{s=JSON.parse(o)}catch(n){r.warn(`failed to parse ${t} ${e}`,n);continue}let[,c,l]=i,u=Xe(c,n,r),d=`${u}:${l}`,f={...T(s,`ourUuid`),id:d,ourServiceId:u};a.run({id:e,newId:d,newJson:JSON.stringify(f)})}}function Je(e,t,n){let r=e.prepare(`SELECT id, queueType, data FROM jobs`).all(),a=e.prepare(`UPDATE jobs SET data = $data WHERE id IS $id`),o=0;for(let{id:e,queueType:s,data:c}of r)try{let r=JSON.parse(c),l;if(s===`conversation`){let e=r,t;e.type===`DeleteStoryForEveryone`?t={...e,updatedStoryRecipients:e.updatedStoryRecipients.map(({destinationUuid:e,legacyDestinationUuid:t,destinationAci:r,destinationPni:a,...o})=>({...o,destinationServiceId:i.Wr(e||r||a||t,`DeleteStoryForEveryone`,n)}))}:e.type===`ResendRequest`?t={...T(e,`senderUuid`),senderAci:i.er(e.senderUuid,`ResendRequest`,n)}:e.type===`Receipts`&&(t={...e,receipts:e.receipts.map(({senderUuid:e,...t})=>({...t,senderAci:i.er(e,`Receipts`,n)}))}),l=t}else if(s===`read sync`){let e=r;l={...e,readSyncs:e.readSyncs.map(({senderUuid:e,...t})=>({...t,senderAci:i.er(e,`read sync`)}))}}else if(s===`view sync`){let e=r;l={...e,viewSyncs:e.viewSyncs.map(({senderUuid:e,...t})=>({...t,senderAci:i.er(e,`read sync`)}))}}else if(s===`view once open sync`){let e=r;l={...e,viewOnceOpens:e.viewOnceOpens.map(({senderUuid:e,...t})=>({...t,senderAci:i.er(e,`read sync`)}))}}else if(s===`single proto`){let{identifier:i,...a}=r,o=t.get(i);if(!o){n.warn(`failed to resolve identifier ${i} for job ${e}/${s}`);continue}l={...a,serviceId:o}}l!==void 0&&(o+=1,a.run({id:e,data:JSON.stringify(l)}))}catch(t){n.warn(`failed to migrate job ${e}/${s} json`,t)}n.info(`updated ${o} jobs`)}function Ye({bodyRanges:e,quote:t,...n},r,a){return{...n,bodyRanges:e?Qe(e,`${r}.bodyRanges`,a):void 0,quote:t?{...t,authorAci:i.er(t.authorUuid,`${r}.quote.authorUuid`,a),bodyRanges:t.bodyRanges?Qe(t.bodyRanges,`${r}.quote.bodyRanges`,a):void 0}:void 0}}function Xe(e,{legacyAci:t,legacyPni:n,aci:r,pni:a},o){if(e!=null)return e===t?r:e===n?a:i.Wr(e,`migrateServiceId(${e})`,o)}function Ze(e,t,n){if(e!=null)return e.toLowerCase().startsWith(`pni:`)?i.Ur(e,t,n):i.Ur(`PNI:${e}`,t,n)}function Qe(e,t,n){if(e!=null)return e?.map(({mentionUuid:e,...r})=>({...r,mentionAci:i.er(e,t,n)}))}function $e(e){return T(e,`targetAuthorUuid`)}const et=new Set([`pending-add-one`,`pending-remove-one`]);function tt({type:e,uuid:t,...n},r){let a,o;return et.has(e)?o=i.Wr(t,`migrateGroupChange(${e})`,r):a=i.er(t,`migrateGroupChange(${e})`,r),{...n,type:e,aci:a,serviceId:o}}t.cn(),i.Ot(),t.Ii(),t.sa();const{isObject:nt}=m.default;function rt(e){if(e.callMode===i.pt.Direct||e.callMode===i.pt.Group)return e;if(Object.hasOwn(e,`wasIncoming`)&&Object.hasOwn(e,`wasVideoCall`))return{callMode:i.pt.Direct,...e};if(Object.hasOwn(e,`eraId`)&&Object.hasOwn(e,`startedTime`))return{callMode:i.pt.Group,...e};throw Error(`Could not determine call mode`)}function it(e,n){return e.type===`private`?e.serviceId==null?(n.warn(`Private conversation (${e.id}) was missing serviceId (discoveredUnregisteredAt: ${e.discoveredUnregisteredAt})`),e.id):(t.Ri(i.Xr(e.serviceId),`ACI must exist for direct chat`),e.serviceId):(t.Ri(e.groupId!=null,`groupId must exist for group chat`),e.groupId)}function at(e,r,a,o,s){let c=rt(o),{callMode:l}=c,u,d,p,m,h,g=null;t.Ri(l!=null,`mode must exist`);let _=a.timestamp??a.sent_at??a.received_at_ms??0;if(l===i.pt.Direct)u=c.callId??t.v(),d=c.wasVideoCall?i.ht.Video:i.ht.Audio,p=c.wasIncoming?i.ut.Incoming:i.ut.Outgoing,m=c.acceptedTime==null?c.wasDeclined?i._t.Declined:i._t.Missed:i._t.Accepted,h=c.acceptedTime??c.endedTime??_;else if(l===i.pt.Group)u=(0,f.callIdFromEra)(c.eraId).toString(),d=i.ht.Group,p=c.creatorUuid===e?i.ut.Outgoing:i.ut.Incoming,m=i.vt.GenericGroupCall,h=c.startedTime??_,g=c.creatorUuid;else throw n.p(l);let v=t.ma(i.wt,{callId:u,peerId:r,ringerId:g,mode:l,type:d,direction:p,status:m,timestamp:h,startedById:null,endedTimestamp:null});if(v.success)return v.data;throw s.error(`convertLegacyCallDetails: Could not convert ${l} call`,v.error.toString()),Error(`Failed to convert legacy ${l} call details`)}function ot(e,n){let r=g(e),[i]=t.mn`
    -- This table may have already existed from migration 87
    CREATE TABLE IF NOT EXISTS callsHistory (
      callId TEXT PRIMARY KEY,
      peerId TEXT NOT NULL, -- conversation id (legacy) | uuid | groupId | roomId
      ringerId TEXT DEFAULT NULL, -- ringer uuid
      mode TEXT NOT NULL, -- enum "Direct" | "Group"
      type TEXT NOT NULL, -- enum "Audio" | "Video" | "Group"
      direction TEXT NOT NULL, -- enum "Incoming" | "Outgoing
      -- Direct: enum "Pending" | "Missed" | "Accepted" | "Deleted"
      -- Group: enum "GenericGroupCall" | "OutgoingRing" | "Ringing" | "Joined" | "Missed" | "Declined" | "Accepted" | "Deleted"
      status TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      UNIQUE (callId, peerId) ON CONFLICT FAIL
    );

    -- Update peerId to be uuid or groupId
    UPDATE callsHistory
      SET peerId = (
        SELECT
          CASE
            WHEN conversations.type = 'private' THEN conversations.serviceId
            WHEN conversations.type = 'group' THEN conversations.groupId
          END
        FROM conversations
        WHERE callsHistory.peerId IS conversations.id
          AND callsHistory.peerId IS NOT conversations.serviceId
      )
      WHERE EXISTS (
        SELECT 1
        FROM conversations
        WHERE callsHistory.peerId IS conversations.id
          AND callsHistory.peerId IS NOT conversations.serviceId
      );

    CREATE INDEX IF NOT EXISTS callsHistory_order on callsHistory (timestamp DESC);
    CREATE INDEX IF NOT EXISTS callsHistory_byConversation ON callsHistory (peerId);
    -- For 'getCallHistoryGroupData':
    -- This index should target the subqueries for 'possible_parent' and 'possible_children'
    CREATE INDEX IF NOT EXISTS callsHistory_callAndGroupInfo_optimize on callsHistory (
      direction,
      peerId,
      timestamp DESC,
      status
    );
  `;e.exec(i);let[a]=t.mn`
    SELECT
      messages.json AS messageJson,
      conversations.id AS conversationId,
      conversations.json AS conversationJson
    FROM messages
    LEFT JOIN conversations ON conversations.id = messages.conversationId
    WHERE messages.type = 'call-history'
    -- Some of these messages were already migrated
    AND messages.json->'callHistoryDetails' IS NOT NULL
    -- Sort from oldest to newest, so that newer messages can overwrite older
    ORDER BY messages.received_at ASC, messages.sent_at ASC;
  `,o=e.prepare(a).all();for(let i of o){let{messageJson:a,conversationId:o,conversationJson:s}=i,c=t.ln(a),l=t.ln(s);if(!nt(l)){n.warn(`Private conversation (${o}) has non-object json column`);continue}let u=c.callHistoryDetails,d=at(r,it(l,n),c,u,n),[f,p]=t.mn`
      -- Using 'OR REPLACE' because in some earlier versions of call history
      -- we had a bug where we would insert duplicate call history entries
      -- for the same callId and peerId.
      -- We're assuming here that the latest call history entry is the most
      -- accurate.
      INSERT OR REPLACE INTO callsHistory (
        callId,
        peerId,
        ringerId,
        mode,
        type,
        direction,
        status,
        timestamp
      ) VALUES (
        ${d.callId},
        ${d.peerId},
        ${d.ringerId},
        ${d.mode},
        ${d.type},
        ${d.direction},
        ${d.status},
        ${d.timestamp}
      )
    `;e.prepare(f).run(p);let m=c.id;t.Ri(m!=null,`message.id must exist`);let[h,g]=t.mn`
      UPDATE messages
      SET json = JSON_PATCH(json, ${JSON.stringify({callHistoryDetails:null,callId:d.callId})})
      WHERE id = ${m}
    `;e.prepare(h).run(g)}let[s]=t.mn`
    DROP INDEX IF EXISTS messages_call;
  `;e.exec(s);try{let[n]=t.mn`
      ALTER TABLE messages
        DROP COLUMN callMode;
    `;e.exec(n)}catch(e){if(!e.message.includes(`no such column: "callMode"`))throw e}try{let[n]=t.mn`
      ALTER TABLE messages
        DROP COLUMN callId;
    `;e.exec(n)}catch(e){if(!e.message.includes(`no such column: "callId"`))throw e}let[c]=t.mn`
    ALTER TABLE messages
      ADD COLUMN callId TEXT
      GENERATED ALWAYS AS (
        json_extract(json, '$.callId')
      );
    -- Optimize getCallHistoryMessageByCallId
    CREATE INDEX messages_call ON messages
      (conversationId, type, callId);

    CREATE INDEX messages_callHistory_readStatus ON messages
      (type, readStatus)
      WHERE type IS 'call-history';
  `;e.exec(c)}t.bi(),t.li();var st=t.c();t.s(),t.cn();function ct(e,n){let r=0,[i,a]=t.mn`
      UPDATE messages
      SET json = json_remove(json, '$.storyReplyContext.attachment.screenshotData')
      WHERE isStory = 0

      /* we want to find all messages with a non-null storyId, but using string 
      comparison (instead of a non-null check) here causes Sqlite to use the 
      storyId index */
      AND storyId > '0' 

      AND json->'$.storyReplyContext.attachment.screenshotData' IS NOT NULL;
  `;r=e.prepare(i).run(a).changes,n.info(`removed screenshotData from ${r} message${r>1?`s`:``}`)}t.cn(),i.zr(),t.Oa();function lt(e,n){e.exec(`
    --- First, prekeys
    DROP INDEX preKeys_ourServiceId;

    ALTER TABLE preKeys
      DROP COLUMN ourServiceId;
    ALTER TABLE preKeys
      ADD COLUMN ourServiceId NUMBER
      GENERATED ALWAYS AS (json_extract(json, '$.ourServiceId'));

    CREATE INDEX preKeys_ourServiceId ON preKeys (ourServiceId);

    -- Second, kyber prekeys

    DROP INDEX kyberPreKeys_ourServiceId;

    ALTER TABLE kyberPreKeys
      DROP COLUMN ourServiceId;
    ALTER TABLE kyberPreKeys
      ADD COLUMN ourServiceId NUMBER
      GENERATED ALWAYS AS (json_extract(json, '$.ourServiceId'));

    CREATE INDEX kyberPreKeys_ourServiceId ON kyberPreKeys (ourServiceId);

    -- Finally, signed prekeys

    DROP INDEX signedPreKeys_ourServiceId;

    ALTER TABLE signedPreKeys
      DROP COLUMN ourServiceId;
    ALTER TABLE signedPreKeys
      ADD COLUMN ourServiceId NUMBER
      GENERATED ALWAYS AS (json_extract(json, '$.ourServiceId'));

    CREATE INDEX signedPreKeys_ourServiceId ON signedPreKeys (ourServiceId);
  `);let r=e.prepare(`SELECT count(*) FROM preKeys;`,{pluck:!0}).get()??0;if(n.info(`Found ${r} keys`),r<1e3)return;let a,o=e.prepare(`SELECT json FROM items WHERE id IS 'pni'`,{pluck:!0}).get();try{a=i.Ur(JSON.parse(o??``).value,`updateToSchemaVersion91`)}catch(e){o?n.warn(`PNI found but did not parse`,t.Aa(e)):n.info(`Our PNI not found`);return}let[s,c]=t.mn`SELECT count(*) from preKeys WHERE ourServiceId = ${a}`,l=e.prepare(s,{pluck:!0}).get(c);n.info(`Found ${l} preKeys for PNI`),e.exec(`
    ALTER TABLE preKeys
      ADD COLUMN createdAt NUMBER
        GENERATED ALWAYS AS (json_extract(json, '$.createdAt'));

    CREATE INDEX preKeys_date
      ON preKeys (ourServiceId, createdAt);
  `),n.info(`Temporary index created`);let[u,d]=t.mn`
    SELECT createdAt
    FROM preKeys
    WHERE
      createdAt IS NOT NULL AND
      ourServiceId = ${a}
    ORDER BY createdAt ASC
    LIMIT 1
    OFFSET 499
  `,f=e.prepare(u,{pluck:!0}).get(d);n.info(`Found 500th-oldest timestamp: ${f}`);let[p,m]=t.mn`
    SELECT createdAt
    FROM preKeys
    WHERE
      createdAt IS NOT NULL AND
      ourServiceId = ${a}
    ORDER BY createdAt DESC
    LIMIT 1
    OFFSET 499
  `,h=e.prepare(p,{pluck:!0}).get(m);n.info(`Found 500th-newest timestamp: ${h}`);let g,[_,v]=t.mn`
    DELETE FROM preKeys
    WHERE rowid IN (
      SELECT rowid FROM preKeys
      WHERE
        createdAt IS NOT NULL AND
        createdAt > ${f??null} AND
        createdAt < ${h??null} AND
        ourServiceId = ${a}
      LIMIT 10000
    );
  `,y=e.prepare(_);do g=y.run(v),n.info(`Deleted ${g.changes} items`);while(g.changes>0);n.info(`Delete is complete!`);let[b,x]=t.mn`
    SELECT count(*)
    FROM preKeys
    WHERE ourServiceId = ${a};
  `,S=e.prepare(b,{pluck:!0}).get(x);n.info(`Found ${S} preKeys for PNI after delete`),e.exec(`
    DROP INDEX preKeys_date;
    ALTER TABLE preKeys DROP COLUMN createdAt;
  `)}function ut(){}function dt(){}function ft(){}i.zr(),i.$n();function pt(e,t){let n=mt(e,t);if(!n){t.info(`not running, pni is normalized`);return}e.prepare(`
      UPDATE conversations
      SET json = json_set(json, '$.pni', $pni)
      WHERE serviceId IS $aci
    `).run({aci:n.aci,pni:n.pni}),ht(e,`preKeys`,n,t),ht(e,`signedPreKeys`,n,t),ht(e,`kyberPreKeys`,n,t)}function mt(e,t){let n=e.prepare(`
    SELECT json
    FROM items
    WHERE id IS 'uuid_id'
  `,{pluck:!0}).get(),r=e.prepare(`
    SELECT json
    FROM items
    WHERE id IS 'pni'
  `,{pluck:!0}).get(),a;try{[a]=JSON.parse(n??``).value.split(`.`,2)}catch(e){n?t.warn(`failed to parse uuid_id item`,e):t.info(`Our ACI not found`)}if(!a)return;let o;try{o=JSON.parse(r??``).value}catch(e){r?t.warn(`failed to parse pni item`,e):t.info(`Our PNI not found`)}if(!o)return;let s=gt(o,`pni`,t);if(!s||s===o)return;let c=e.prepare(`
      SELECT id, json
      FROM items
      WHERE id IN ('identityKeyMap', 'registrationIdMap');
    `).all(),l=e.prepare(`UPDATE items SET json = $json WHERE id IS $id`);l.run({id:`pni`,json:JSON.stringify({id:`pni`,value:s})});for(let{id:e,json:n}of c)try{let t=JSON.parse(n),r=t.value[o];r&&(delete t.value[o],t.value[s]=r),l.run({id:e,json:JSON.stringify(t)})}catch(n){t.warn(`failed to parse ${e} item`,n)}return{aci:i.er(a,`uuid_id`,t),pni:s,legacyPni:o}}function ht(e,t,{legacyPni:n,pni:r},i){let a=e.prepare(`SELECT id, json FROM ${t} WHERE ourServiceId IS $legacyPni`).all({legacyPni:n}),o=e.prepare(`
    UPDATE ${t}
    SET id = $newId, json = $newJson
    WHERE id = $id
  `);i.info(`updating ${a.length} ${t}`);for(let{id:e,json:s}of a){let a=e.match(/^(.*):(.*)$/);if(!a){i.warn(`invalid ${t} id ${e}`);continue}let c;try{c=JSON.parse(s)}catch(n){i.warn(`failed to parse ${t} ${e}`,n);continue}let[,l,u]=a;if(l!==n){i.warn(`unexpected ourServiceId`,l,n);continue}let d=`${r}:${u}`,f={...c,id:d,ourServiceId:r};o.run({id:e,newId:d,newJson:JSON.stringify(f)})}}function gt(e,t,n){if(e!=null)return e.toLowerCase().startsWith(`pni:`)?i.Ur(e,t,n):i.Ur(`PNI:${e}`,t,n)}function _t(e){e.exec(`
    INSERT INTO messages_fts(messages_fts) VALUES ('optimize');
  `)}function vt(e){e.exec(`
    ALTER TABLE reactions ADD COLUMN timestamp NUMBER;

    CREATE INDEX reactions_byTimestamp
    ON reactions
    (fromId, timestamp);
  `)}function yt(e){e.exec(`
    UPDATE conversations
    SET json = json_remove(
      json_insert(
        json,
        '$.sharingPhoneNumber',
        iif(
          json ->> '$.notSharingPhoneNumber',
          -- We flip the value from false to true, and vice versa
          json('false'),
          json('true')
        )
      ),
      '$.notSharingPhoneNumber'
    )
    -- Default value of '$.notSharingPhoneNumber' is true and
    -- the default value of '$.sharingPhoneNumber' is false so we don't have
    -- to do anything if the field wasn't present.
    WHERE json ->> '$.notSharingPhoneNumber' IS NOT NULL;
  `)}i.rt(),i.T(),t.Ii(),t.cn();const bt=t.hn(i.nt.Unread),xt=t.hn(i.nt.Read),St=t.hn(i.w.Unseen);function Ct(e){let[n]=t.mn`
    SELECT id
    FROM messages
    WHERE messages.type = 'call-history'
      AND messages.readStatus IS ${bt}
  `,r=e.prepare(n).all();for(let n of r){let{id:r}=n;t.Ri(r!=null,`message id must exist`);let[a,o]=t.mn`
      UPDATE messages
      SET
        json = JSON_PATCH(json, ${JSON.stringify({readStatus:i.nt.Read,seenStatus:i.w.Unseen})}),
        readStatus = ${xt},
        seenStatus = ${St}
      WHERE id = ${r}
    `;e.prepare(a).run(o)}}t.cn();function wt(e){let[n]=t.mn`
    CREATE TABLE callLinks (
      roomId TEXT NOT NULL PRIMARY KEY,
      rootKey BLOB NOT NULL,
      adminKey BLOB,
      name TEXT NOT NULL,
      -- Enum which stores CallLinkRestrictions from ringrtc
      restrictions INTEGER NOT NULL,
      revoked INTEGER NOT NULL,
      expiration INTEGER
    ) STRICT;
  `;e.exec(n)}t.cn();function Tt(e,n){let r=g(e);if(r==null){n.info(`not linked`);return}let[i,a]=t.mn`
    SELECT id FROM conversations
    WHERE serviceId IS ${r}
  `,o=e.prepare(i,{pluck:!0}).get(a);if(o==null){n.error(`no conversation`);return}let[s,c]=t.mn`
    DELETE FROM messages
    WHERE
      conversationId IS ${o} AND
      type IS 'conversation-merge'
  `,{changes:l}=e.prepare(s).run(c);l!==0&&n.warn(`removed ${l} self merges`)}t.cn();function Et(e){let n=t.gn`
    type IS NULL
    OR
    type NOT IN (
      'change-number-notification',
      'contact-removed-notification',
      'conversation-merge',
      'group-v1-migration',
      'keychange',
      'message-history-unsynced',
      'profile-change',
      'story',
      'universal-timer-notification',
      'verified-change'
    )
    AND NOT (
      type IS 'message-request-response-event'
      AND json_extract(json, '$.messageRequestResponseEvent') IN ('ACCEPT', 'BLOCK', 'UNBLOCK')
    )
  `,[r]=t.mn`
    --- These will be re-added below
    DROP INDEX messages_preview;
    DROP INDEX messages_preview_without_story;
    DROP INDEX messages_activity;
    DROP INDEX message_user_initiated;

    --- These will also be re-added below
    ALTER TABLE messages DROP COLUMN shouldAffectActivity;
    ALTER TABLE messages DROP COLUMN shouldAffectPreview;

    --- (change: added message-request-response-event->ACCEPT/BLOCK/UNBLOCK)
    ALTER TABLE messages
      ADD COLUMN shouldAffectPreview INTEGER
      GENERATED ALWAYS AS (${n});
    ALTER TABLE messages
      ADD COLUMN shouldAffectActivity INTEGER
      GENERATED ALWAYS AS (${n});

    --- From migration 88
    CREATE INDEX messages_preview ON messages
      (conversationId, shouldAffectPreview, isGroupLeaveEventFromOther,
       received_at, sent_at);

    --- From migration 88
    CREATE INDEX messages_preview_without_story ON messages
      (conversationId, shouldAffectPreview, isGroupLeaveEventFromOther,
       received_at, sent_at) WHERE storyId IS NULL;

    --- From migration 88
    CREATE INDEX messages_activity ON messages
      (conversationId, shouldAffectActivity, isTimerChangeFromSync,
       isGroupLeaveEventFromOther, received_at, sent_at);

    --- From migration 81
    CREATE INDEX message_user_initiated ON messages (conversationId, isUserInitiatedMessage);
  `;e.exec(r)}t.Bt(),t.cn(),t.Jt(),t.sa(),t.Qi(),t.bn();const Dt=t.Qa({attachment:t.Qa({size:t.Za(),contentType:t.Ji}).passthrough(),attachmentType:t.Vt,ciphertextSize:t.Za(),contentType:t.Ji,digest:t.to(),isManualDownload:t.Wa().optional(),messageId:t.to(),messageIdForLogging:t.to().optional(),receivedAt:t.Za(),sentAt:t.Za(),size:t.Za(),source:t.Ya(t.Ht)}).and(t.xn);function Ot(e,n){let r=e.prepare(`
        SELECT id, timestamp, pending, json from attachment_downloads
      `).all();n.info(`loaded ${r.length} existing jobs`),e.exec(`
      CREATE TABLE tmp_attachment_downloads (
        messageId TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        attachmentType TEXT NOT NULL,
        digest TEXT NOT NULL,
        receivedAt INTEGER NOT NULL,
        sentAt INTEGER NOT NULL,
        contentType TEXT NOT NULL,
        size INTEGER NOT NULL,
        attachmentJson TEXT NOT NULL,
        active INTEGER NOT NULL,
        attempts INTEGER NOT NULL,
        retryAfter INTEGER,
        lastAttemptTimestamp INTEGER,

        PRIMARY KEY (messageId, attachmentType, digest)
      ) STRICT;
  `),e.exec(`DROP TABLE attachment_downloads;`),e.exec(`ALTER TABLE tmp_attachment_downloads RENAME TO attachment_downloads;`),e.exec(`
    CREATE INDEX attachment_downloads_active_receivedAt
      ON attachment_downloads (
        active, receivedAt
    );
  `),e.exec(`
    CREATE INDEX attachment_downloads_active_messageId
      ON attachment_downloads (
        active, messageId
    );
  `),e.exec(`
    CREATE INDEX attachment_downloads_messageId
      ON attachment_downloads (
        messageId
    );
  `);let i=[];for(let e of r)try{let n=t.ln(e.json??``),r=t.la(Dt,{messageId:n.messageId,attachmentType:n.type,attachment:n.attachment,receivedAt:n.timestamp??Date.now(),sentAt:n.timestamp??Date.now(),digest:n.attachment?.digest,contentType:n.attachment?.contentType,size:n.attachment?.size,active:!1,attempts:n.attempts??0,retryAfter:null,lastAttemptTimestamp:null,source:t.Ht.STANDARD,ciphertextSize:0});i.push(r)}catch{n.warn(`unable to transfer job ${e.id} to new table; invalid data`)}let a=0;if(i.length){n.info(`transferring ${i.length} rows`);for(let r of i){let[i,o]=t.mn`
        INSERT INTO attachment_downloads
          (
            messageId,
            attachmentType,
            receivedAt,
            sentAt,
            digest,
            contentType,
            size,
            attachmentJson,
            active,
            attempts,
            retryAfter,
            lastAttemptTimestamp
          )
        VALUES
          (
            ${r.messageId},
            ${r.attachmentType},
            ${r.receivedAt},
            ${r.sentAt},
            ${r.digest},
            ${r.contentType},
            ${r.size},
            ${t.un(r.attachment)},
            ${+!!r.active},
            ${r.attempts},
            ${r.retryAfter},
            ${r.lastAttemptTimestamp}
          );
      `;try{e.prepare(i).run(o),a+=1}catch(e){n.error(`error when transferring row`,e)}}}n.info(`transferred ${a} rows, removed ${r.length-a}`)}t.jn(),t.cn();function kt(e){let[n]=t.mn`
    DROP TABLE IF EXISTS groupSendCombinedEndorsement;
    DROP TABLE IF EXISTS groupSendMemberEndorsement;

    -- From GroupSendEndorsementsResponse->ReceivedEndorsements in libsignal
    -- this is the combined endorsement for all group members
    CREATE TABLE groupSendCombinedEndorsement (
      groupId TEXT NOT NULL PRIMARY KEY, -- Only one endorsement per group
      expiration INTEGER NOT NULL, -- Unix timestamp in seconds
      endorsement BLOB NOT NULL
    ) STRICT;

    -- From GroupSendEndorsementsResponse->ReceivedEndorsements in libsignal
    -- these are the individual endorsements for each group member
    CREATE TABLE groupSendMemberEndorsement (
      groupId TEXT NOT NULL,
      memberAci TEXT NOT NULL,
      expiration INTEGER NOT NULL, -- Unix timestamp in seconds
      endorsement BLOB NOT NULL,
      PRIMARY KEY (groupId, memberAci) -- Only one endorsement per group member
    ) STRICT;
  `;e.exec(n)}function At(e){e.exec(`
    ALTER TABLE messages
      ADD COLUMN isAddressableMessage INTEGER
      GENERATED ALWAYS AS (
        type IS NULL
        OR
        type IN (
          'incoming',
          'outgoing'
        )
      );

    CREATE INDEX messages_by_date_addressable
      ON messages (
        conversationId, isAddressableMessage, received_at, sent_at
    );

    CREATE TABLE syncTasks(
      id TEXT PRIMARY KEY NOT NULL,
      attempts INTEGER NOT NULL,
      createdAt INTEGER NOT NULL,
      data TEXT NOT NULL,
      envelopeId TEXT NOT NULL,
      sentAt INTEGER NOT NULL,
      type TEXT NOT NULL
    ) STRICT;

    CREATE INDEX syncTasks_order ON syncTasks (
      createdAt, sentAt, id
    )
  `)}function jt(e){e.exec(`
    CREATE TABLE attachment_backup_jobs (
      mediaName TEXT NOT NULL PRIMARY KEY,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      receivedAt INTEGER NOT NULL,

      -- job manager fields
      attempts INTEGER NOT NULL,
      active INTEGER NOT NULL,
      retryAfter INTEGER,
      lastAttemptTimestamp INTEGER
    ) STRICT;

    CREATE INDEX attachment_backup_jobs_receivedAt
      ON attachment_backup_jobs (
        receivedAt
    );

    CREATE INDEX attachment_backup_jobs_type_receivedAt
      ON attachment_backup_jobs (
        type, receivedAt
    );

    CREATE TABLE backup_cdn_object_metadata (
      mediaId TEXT NOT NULL PRIMARY KEY,
      cdnNumber INTEGER NOT NULL,
      sizeOnBackupCdn INTEGER
    ) STRICT;
  `)}function Mt(e){e.exec(`
    CREATE INDEX messages_by_date_addressable_nondisappearing
      ON messages (
        conversationId, isAddressableMessage, received_at, sent_at
    ) WHERE expireTimer IS NULL;
  `)}function Nt(e){e.exec(`
    CREATE INDEX reactions_messageId
      ON reactions (messageId);

    CREATE INDEX storyReads_storyId
      ON storyReads (storyId);
  `)}t.cn();function Pt(e){let[n]=t.mn`
    -- Fix: Query went from readStatus to seenStatus but index wasn't updated
    DROP INDEX IF EXISTS messages_callHistory_readStatus;
    DROP INDEX IF EXISTS messages_callHistory_seenStatus;
    CREATE INDEX messages_callHistory_seenStatus
      ON messages (type, seenStatus)
      WHERE type IS 'call-history';

    -- Update to index created in 89: add sent_at to make it covering, and where clause to make it smaller
    DROP INDEX IF EXISTS messages_call;
    CREATE INDEX messages_call ON messages
      (type, conversationId, callId, sent_at)
      WHERE type IS 'call-history';

    -- Update to index created in 89: add callId and peerId to make it covering
    DROP INDEX IF EXISTS callsHistory_order;
    CREATE INDEX callsHistory_order ON callsHistory
      (timestamp DESC, callId, peerId);

    -- Update to index created in 89: add timestamp for querying by order and callId to make it covering
    DROP INDEX IF EXISTS callsHistory_byConversation;
    DROP INDEX IF EXISTS callsHistory_byConversation_order;
    CREATE INDEX callsHistory_byConversation_order ON callsHistory (peerId, timestamp DESC, callId);

    -- Optimize markAllCallHistoryRead
    DROP INDEX IF EXISTS messages_callHistory_markReadBefore;
    CREATE INDEX messages_callHistory_markReadBefore
      ON messages (type, seenStatus, sent_at DESC)
      WHERE type IS 'call-history';

    -- Optimize markAllCallHistoryReadInConversation
    DROP INDEX IF EXISTS messages_callHistory_markReadByConversationBefore;
    CREATE INDEX messages_callHistory_markReadByConversationBefore
      ON messages (type, conversationId, seenStatus, sent_at DESC)
      WHERE type IS 'call-history';
  `;e.exec(n)}function Ft(e){e.exec(`
    ALTER TABLE stickers
      ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

    ALTER TABLE stickers
      ADD COLUMN localKey TEXT;

    ALTER TABLE stickers
      ADD COLUMN size INTEGER;
  `)}function It(e){e.exec(`
    CREATE INDEX edited_messages_messageId
      ON edited_messages(messageId);

    CREATE INDEX mentions_messageId
      ON mentions(messageId);
  `)}function Lt(e){e.exec(`
    CREATE INDEX messages_isStory
      ON messages(received_at, sent_at)
      WHERE isStory = 1;
  `)}function Rt(e){e.exec(`
    DROP INDEX IF EXISTS callLinks_deleted;

    ALTER TABLE callLinks
      ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;

    CREATE INDEX callLinks_deleted
      ON callLinks (deleted, roomId);
  `)}function zt(e){e.exec(`
    -- All future conversations will start from '1'
    ALTER TABLE conversations
      ADD COLUMN expireTimerVersion INTEGER NOT NULL DEFAULT 1;

    -- All current conversations will start from '2'
    UPDATE conversations SET expireTimerVersion = 2;
  `)}t.cn(),i.Ot();const Bt=t.hn(i.mt.Missed),Vt=t.hn(i.ut.Incoming);function Ht(e){let[n]=t.mn`
    DROP INDEX IF EXISTS callsHistory_incoming_missed;

    CREATE INDEX callsHistory_incoming_missed
      ON callsHistory (callId, status, direction)
      WHERE status IS ${Bt}
        AND direction IS ${Vt};
  `;e.exec(n)}t.cn();function Ut(e){let[n]=t.mn`
    DROP INDEX IF EXISTS messages_callHistory_markReadBefore;
    CREATE INDEX messages_callHistory_markReadBefore
      ON messages (type, seenStatus, received_at DESC)
      WHERE type IS 'call-history';
  `;e.exec(n)}t.Jt();function Wt(e){e.exec(`
    ALTER TABLE attachment_downloads
        ADD COLUMN source TEXT NOT NULL DEFAULT ${t.Ht.STANDARD};

    ALTER TABLE attachment_downloads
        -- this default value will be overridden by getNextAttachmentDownloadJobs
        ADD COLUMN ciphertextSize INTEGER NOT NULL DEFAULT 0;
  `),e.exec(`
    CREATE INDEX attachment_downloads_source_ciphertextSize
        ON attachment_downloads (
            source, ciphertextSize
        );
  `)}function Gt(e){e.exec(`
    ALTER TABLE callLinks ADD COLUMN storageID TEXT;
    ALTER TABLE callLinks ADD COLUMN storageVersion INTEGER;
    ALTER TABLE callLinks ADD COLUMN storageUnknownFields BLOB;
    ALTER TABLE callLinks ADD COLUMN storageNeedsSync INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE callLinks ADD COLUMN deletedAt INTEGER;
  `),e.prepare(`
    UPDATE callLinks
      SET deletedAt = $deletedAt
      WHERE deleted = 1;
    `).run({deletedAt:new Date().getTime()})}function Kt(e){e.exec(`
    CREATE INDEX attachment_downloads_active_source_receivedAt
        ON attachment_downloads (
            active, source, receivedAt
        );
  `)}function qt(e){e.exec(`
    ALTER TABLE callsHistory
      ADD COLUMN startedById TEXT DEFAULT NULL;

    ALTER TABLE callsHistory
      ADD COLUMN endedTimestamp INTEGER DEFAULT NULL;
  `)}t.Dr();const{get:Jt,isFinite:Yt,isInteger:Xt,isString:Zt}=m.default;function Qt(e){return st.signal.proto.storage.RecordStructure.encode(e)}function $t(e,t){let n=e.sessions||{},r=Object.values(n),i=r.find(e=>e?.indexInfo?.closed===-1),a;a=i?en(i,t):null,r.sort((e,t)=>(t?.indexInfo?.closed||0)-(e?.indexInfo?.closed||0));let o=r.filter(e=>e?.indexInfo?.closed!==-1);if(o.length<r.length-1)throw Error(`toProtobuf: More than one open session!`);let s=[];if(o.forEach(e=>{s.push(en(e,t))}),!a&&s.length===0)throw Error(`toProtobuf: Record had no sessions!`);return{currentSession:a,previousSessions:s}}function en(e,t){let n=e.currentRatchet?.ephemeralKeyPair?.pubKey;if(!n)throw Error(`toProtobufSession: No sender base key!`);let r=e[n];if(!r)throw Error(`toProtobufSession: No matching chain found with senderBaseKey!`);if(r.chainType!==1)throw Error(`toProtobufSession: Expected sender chain type for senderChain, got ${r.chainType}`);let i=tn(r);i.senderRatchetKey=E(e,`currentRatchet.ephemeralKeyPair.pubKey`,33),i.senderRatchetKeyPrivate=E(e,`currentRatchet.ephemeralKeyPair.privKey`,32);let a=e.currentRatchet?.lastRemoteEphemeralKey;if(!a)throw Error(`toProtobufSession: No receiver base key!`);let o=e[a],s=[];if(o){let t=tn(o);if(o.chainType!==2)throw Error(`toProtobufSession: Expected receiver chain type for firstReceiverChain, got ${o.chainType}`);t.senderRatchetKey=E(e,`currentRatchet.lastRemoteEphemeralKey`,33),s.push(t)}return(e.oldRatchetList||[]).slice(0).sort((e,t)=>(t.added||0)-(e.added||0)).forEach(t=>{let n=t.ephemeralKey;if(!n)throw Error(`toProtobufSession: No base key for old receiver chain!`);let r=e[n];if(!r)throw Error(`toProtobufSession: No chain for old receiver chain base key!`);if(r.chainType!==2)throw Error(`toProtobufSession: Expected receiver chain type, got ${r.chainType}`);let i=tn(r);i.senderRatchetKey=E(t,`ephemeralKey`,33),s.push(i)}),{aliceBaseKey:E(e,`indexInfo.baseKey`,33),localIdentityPublic:t.identityKeyPublic,localRegistrationId:t.registrationId,previousCounter:D(e,`currentRatchet.previousCounter`)+1,remoteIdentityPublic:E(e,`indexInfo.remoteIdentityKey`,33),remoteRegistrationId:D(e,`registrationId`),rootKey:E(e,`currentRatchet.rootKey`,32),sessionVersion:3,pqRatchetState:null,needsRefresh:null,pendingPreKey:e.pendingPreKey?{baseKey:E(e,`pendingPreKey.baseKey`,33),signedPreKeyId:D(e,`pendingPreKey.signedKeyId`),preKeyId:e.pendingPreKey.preKeyId===void 0?null:D(e,`pendingPreKey.preKeyId`)}:null,senderChain:i,receiverChains:s}}function tn(e){let t=Object.entries(e.messageKeys||{});return{chainKey:{index:D(e,`chainKey.counter`)+1,key:e.chainKey?.key===void 0?null:E(e,`chainKey.key`,32)},messageKeys:t.map(e=>{let{cipherKey:t,macKey:n,iv:r}=nn(E(e,`1`,32));return{index:D(e,`0`)+1,cipherKey:t,macKey:n,iv:r}}),senderRatchetKey:null,senderRatchetKeyPrivate:null}}function nn(e){let[n,r,i]=t.fr(e,new Uint8Array(32),t.yi(`WhisperMessageKeys`));return{cipherKey:n,macKey:r,iv:i.subarray(0,16)}}function E(e,n,r){let i=Jt(e,n);if(i==null)throw Error(`binaryToUint8Array: Falsey path ${n}`);if(!Zt(i))throw Error(`binaryToUint8Array: String not found at path ${n}`);let a=t._i(i);if(r&&a.byteLength!==r)throw Error(`binaryToUint8Array: Got unexpected length ${a.byteLength} instead of ${r} at path ${n}`);return a}function D(e,t){let n=Jt(e,t);if(n==null)throw Error(`getInteger: Falsey path ${t}`);if(Zt(n)){let e=parseInt(n,10);if(!Yt(e))throw Error(`getInteger: Value could not be parsed as number at ${t}: {target}`);if(!Xt(e))throw Error(`getInteger: Parsed value not an integer at ${t}: {target}`);return e}if(!Xt(n))throw Error(`getInteger: Value not an integer at ${t}: {target}`);return n}t.Na(),t.Oa(),n.f();const rn=t.Pa.record(t.Pa.string(),t.Pa.object({privKey:t.Pa.string().transform(e=>Buffer.from(e,`base64`)),pubKey:t.Pa.string().transform(e=>Buffer.from(e,`base64`))})),an=t.Pa.record(t.Pa.string(),t.Pa.number()),on=t.Pa.object({id:t.Pa.string(),ourServiceId:t.Pa.string(),serviceId:t.Pa.string(),conversationId:t.Pa.string(),deviceId:t.Pa.number(),record:t.Pa.string(),version:t.Pa.literal(1).or(t.Pa.literal(2))});function sn(e,r,i,a){let{id:o,conversationId:s,ourServiceId:l,serviceId:u,json:d}=e,f=on.parse(JSON.parse(d));if(c.default.strictEqual(f.id,o,`Invalid id`),c.default.strictEqual(f.conversationId,s,`Invalid conversationId`),c.default.strictEqual(f.ourServiceId,l,`Invalid ourServiceId,`),c.default.strictEqual(f.serviceId,u,`Invalid serviceId`),f.version===2)return{id:o,conversationId:s,ourServiceId:l,serviceId:u,deviceId:f.deviceId,record:Buffer.from(f.record,`base64`)};if(f.version===1){let e=t.x(r,l);if(!e)throw Error(`migrateSession: No identity key for ourself!`);let n=t.x(i,l);if(n==null)throw Error(`_maybeMigrateSession: No registration id for ourself!`);let c={identityKeyPublic:e.pubKey,registrationId:n};a.info(`migrateSession: Migrating session with id ${o}`);let d=$t(JSON.parse(f.record),c);return{id:o,conversationId:s,ourServiceId:l,serviceId:u,deviceId:f.deviceId,record:Buffer.from(Qt(d))}}throw n.p(f.version)}function cn(e,n){e.exec(`
    ALTER TABLE sessions
      RENAME TO old_sessions;

    CREATE TABLE sessions (
      id TEXT NOT NULL PRIMARY KEY,
      ourServiceId TEXT NOT NULL,
      serviceId TEXT NOT NULL,
      conversationId TEXT NOT NULL,
      deviceId INTEGER NOT NULL,
      record BLOB NOT NULL
    ) STRICT;
  `);let r=e.prepare(`
    SELECT json -> '$.value' FROM items WHERE id IS ?
  `,{pluck:!0}),i=r.get([`identityKeyMap`]),a=r.get([`registrationIdMap`]);if(!i||!a){n.info(`no identity/registration id`),e.exec(`DROP TABLE old_sessions`);return}let o=rn.parse(JSON.parse(i)),s=an.parse(JSON.parse(a)),c=e.prepare(`DELETE FROM old_sessions RETURNING * LIMIT 1000`),l=e.prepare(`
    INSERT INTO sessions
    (id, ourServiceId, serviceId, conversationId, deviceId, record)
    VALUES
    ($id, $ourServiceId, $serviceId, $conversationId, $deviceId, $record)
  `),u=0,d=0;for(;;){let e=c.all();if(e.length===0)break;for(let r of e)try{l.run(sn(r,o,s,n)),u+=1}catch(e){d+=1,n.error(`failed to migrate session`,t.Aa(e))}}n.info(`migrated ${u} sessions, ${d} failed`),e.exec(`DROP TABLE old_sessions`)}function ln(e){e.exec(`
    DROP INDEX IF EXISTS callLinks_adminKey;

    CREATE INDEX callLinks_adminKey
      ON callLinks (adminKey);
  `)}t.cn();function un(e){let[n]=t.mn`
    CREATE TABLE defunctCallLinks (
      roomId TEXT NOT NULL PRIMARY KEY,
      rootKey BLOB NOT NULL,
      adminKey BLOB
    ) STRICT;
  `;e.exec(n)}function dn(e){e.exec(`
    ALTER TABLE defunctCallLinks ADD COLUMN storageID TEXT;
    ALTER TABLE defunctCallLinks ADD COLUMN storageVersion INTEGER;
    ALTER TABLE defunctCallLinks ADD COLUMN storageUnknownFields BLOB;
    ALTER TABLE defunctCallLinks ADD COLUMN storageNeedsSync INTEGER NOT NULL DEFAULT 0;
  `)}t.cn();function fn(e){let[n]=t.mn`
    DROP INDEX IF EXISTS syncTasks_order;
    CREATE INDEX syncTasks_delete ON syncTasks (attempts DESC);
  `;e.exec(n)}t.cn();function pn(e){let[n]=t.mn`
    ALTER TABLE messages
      ADD COLUMN timestamp INTEGER;
    ALTER TABLE messages
      ADD COLUMN received_at_ms INTEGER;
    ALTER TABLE messages
      ADD COLUMN unidentifiedDeliveryReceived INTEGER;
    ALTER TABLE messages
      ADD COLUMN serverTimestamp INTEGER;

    ALTER TABLE messages
      RENAME COLUMN source TO legacySource;
    ALTER TABLE messages
      ADD COLUMN source TEXT;

    UPDATE messages SET
      timestamp = json_extract(json, '$.timestamp'),
      received_at_ms = json_extract(json, '$.received_at_ms'),
      unidentifiedDeliveryReceived =
        json_extract(json, '$.unidentifiedDeliveryReceived'),
      serverTimestamp =
        json_extract(json, '$.serverTimestamp'),
      source = IFNULL(json_extract(json, '$.source'), '+' || legacySource);

    ALTER TABLE messages
      DROP COLUMN legacySource;
  `;e.exec(n)}t.g(),i.zr(),i.u(),t.cn(),t.Ii();function mn(e,n){let r=g(e),a=e.prepare(`SELECT * FROM unprocessed`).all(),[o]=t.mn`
    DROP TABLE unprocessed;

    CREATE TABLE unprocessed(
      id TEXT NOT NULL PRIMARY KEY ASC,
      type INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      attempts INTEGER NOT NULL,
      receivedAtCounter INTEGER NOT NULL,
      urgent INTEGER NOT NULL,
      story INTEGER NOT NULL,
      serverGuid TEXT NOT NULL,
      serverTimestamp INTEGER NOT NULL,
      isEncrypted INTEGER NOT NULL,
      content BLOB NOT NULL,
      messageAgeSec INTEGER NOT NULL,
      destinationServiceId TEXT NOT NULL,

      -- Not present for 1:1 messages and not sealed messages
      groupId TEXT,

      -- Not present for sealed envelopes
      reportingToken BLOB,
      source TEXT,
      sourceServiceId TEXT,
      sourceDevice TEXT,

      -- Present only for PNP change number
      updatedPni TEXT
    ) STRICT;

    CREATE INDEX unprocessed_timestamp ON unprocessed
      (timestamp);

    CREATE INDEX unprocessed_byReceivedAtCounter ON unprocessed
      (receivedAtCounter);
  `;e.exec(o);let s=e.prepare(`
    INSERT INTO unprocessed
      (id, type, timestamp, attempts, receivedAtCounter, urgent, story,
       serverGuid, serverTimestamp, isEncrypted, content, source,
       messageAgeSec, sourceServiceId, sourceDevice,
       destinationServiceId, reportingToken)
    VALUES
      ($id, $type, $timestamp, $attempts, $receivedAtCounter, $urgent, $story,
       $serverGuid, $serverTimestamp, $isEncrypted, $content, $source,
       $messageAgeSec, $sourceServiceId, $sourceDevice,
       $destinationServiceId, $reportingToken);
  `),c=0;r||a.length&&(n.warn(`no aci, dropping ${a.length} envelopes`),a=[]);for(let e of a){let{id:a,envelope:o,decrypted:l,timestamp:u,attempts:d,version:f,receivedAtCounter:p,urgent:m,story:h,serverGuid:g,serverTimestamp:_,...v}=e;if(f!==2||!o){c+=1;continue}try{let e=t.o.migrations.Envelope.decode(Buffer.from(String(o),`base64`));if(!e.content)throw Error(`Missing envelope content`);let n=l?Buffer.from(String(l),`base64`):e.content;t.Ri(a!=null,`Missing id`),s.run({...v,id:a,type:i.d(t.o.migrations.Envelope.Type,e.type)?e.type:t.o.migrations.Envelope.Type.UNKNOWN,content:n??null,isEncrypted:+!l,timestamp:u||Date.now(),attempts:d||0,receivedAtCounter:p||0,urgent:+!!m,story:+!!h,serverGuid:g||t._(),serverTimestamp:_||0,destinationServiceId:i.Wr(e.destinationServiceId||r,`Envelope.destinationServiceId`)??null,updatedPni:i.Hr(e.updatedPni)?i.Ur(i.Kr(e.updatedPni),`Envelope.updatedPni`):null,messageAgeSec:0,reportingToken:e.reportSpamToken?.length?e.reportSpamToken:null})}catch(e){n.warn(`failed to migrate unprocessed`,a,e)}}c!==0&&n.warn(`dropped ${c} envelopes`)}t.cn();function hn(e){let[n]=t.mn`
    ALTER TABLE unprocessed RENAME COLUMN sourceDevice TO legacySourceDevice;
    ALTER TABLE unprocessed ADD COLUMN sourceDevice INTEGER;

    UPDATE unprocessed
    SET sourceDevice = legacySourceDevice;

    ALTER TABLE unprocessed DROP COLUMN legacySourceDevice;
  `;e.exec(n)}t.cn();function gn(e){let[n]=t.mn`
    ALTER TABLE sticker_references
      ADD COLUMN stickerId INTEGER NOT NULL DEFAULT -1;
    ALTER TABLE sticker_references
      ADD COLUMN isUnresolved INTEGER NOT NULL DEFAULT 0;

    CREATE INDEX unresolved_sticker_refs
    ON sticker_references (packId, stickerId)
    WHERE isUnresolved IS 1;
  `;e.exec(n)}t.cn();function _n(e,n){let[r,i]=t.mn`
    UPDATE conversations
      SET json = json_replace(
        json,
        '$.muteExpiresAt',
        9007199254740991 -- max safe integer
      )
      WHERE json ->> '$.muteExpiresAt' IS ${864e13};
  `,{changes:a}=e.prepare(r).run(i);a!==0&&n.warn(`fixed ${a} conversations`)}t.cn();function vn(e){let[n]=t.mn`
    DROP INDEX unprocessed_timestamp;

    ALTER TABLE unprocessed
      ADD COLUMN receivedAtDate INTEGER DEFAULT 0 NOT NULL;

    UPDATE unprocessed
      SET receivedAtDate = timestamp;

    CREATE INDEX unprocessed_byReceivedAtDate ON unprocessed
      (receivedAtDate);
  `;e.exec(n)}t.cn();function yn(e){let[n]=t.mn`
    CREATE INDEX syncTasks_type ON syncTasks (type);
  `;e.exec(n)}t.cn();function bn(e){let[n]=t.mn`
    CREATE TABLE recentGifs (
      id TEXT NOT NULL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      previewMedia_url TEXT NOT NULL,
      previewMedia_width INTEGER NOT NULL,
      previewMedia_height INTEGER NOT NULL,
      attachmentMedia_url TEXT NOT NULL,
      attachmentMedia_width INTEGER NOT NULL,
      attachmentMedia_height INTEGER NOT NULL,
      lastUsedAt INTEGER NOT NULL
    ) STRICT;

    CREATE INDEX recentGifs_order ON recentGifs (
      lastUsedAt DESC
    );
  `;e.exec(n)}t.cn();function xn(e){let[n]=t.mn`
    CREATE TABLE notificationProfiles(
      id TEXT PRIMARY KEY NOT NULL,

      name TEXT NOT NULL,
      emoji TEXT,
      /* A numeric representation of a color, like 0xAARRGGBB */
      color INTEGER NOT NULL,

      createdAtMs INTEGER NOT NULL,

      allowAllCalls INTEGER NOT NULL,
      allowAllMentions INTEGER NOT NULL,

      /* A JSON array of conversationId strings */
      allowedMembersJson TEXT NOT NULL,
      scheduleEnabled INTEGER NOT NULL,

      /* 24-hour clock int, 0000-2359 (e.g., 15, 900, 1130, 2345) */
      scheduleStartTime INTEGER,
      scheduleEndTime INTEGER,

      /* A JSON object with true/false for each of the numbers in the Protobuf enum */
      scheduleDaysEnabledJson TEXT,
      deletedAtTimestampMs INTEGER,

      storageID TEXT,
      storageVersion INTEGER,
      storageUnknownFields BLOB,
      storageNeedsSync INTEGER NOT NULL DEFAULT 0
    ) STRICT;
  `;e.exec(n)}function Sn(e){e.exec(`
    DROP TABLE IF EXISTS message_attachments;
  `),e.exec(`
    CREATE TABLE message_attachments (
      messageId TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      -- For editHistoryIndex to be part of the primary key, it cannot be NULL in strict tables.
      -- For that reason, we use a value of -1 to indicate that it is the root message (not in editHistory)
      editHistoryIndex INTEGER NOT NULL,
      attachmentType TEXT NOT NULL, -- 'long-message' | 'quote' | 'attachment' | 'preview' | 'contact' | 'sticker'
      orderInMessage INTEGER NOT NULL,
      conversationId TEXT NOT NULL,
      sentAt INTEGER NOT NULL,
      clientUuid TEXT,
      size INTEGER NOT NULL,
      contentType TEXT NOT NULL,
      path TEXT,
      plaintextHash TEXT,
      localKey TEXT,
      caption TEXT,
      fileName TEXT,
      blurHash TEXT,
      height INTEGER,
      width INTEGER,
      digest TEXT,
      key TEXT,
      iv TEXT,
      downloadPath TEXT,
      version INTEGER,
      incrementalMac TEXT,
      incrementalMacChunkSize INTEGER,
      transitCdnKey TEXT,
      transitCdnNumber INTEGER,
      transitCdnUploadTimestamp INTEGER,
      backupMediaName TEXT,
      backupCdnNumber INTEGER,
      isReencryptableToSameDigest INTEGER,
      reencryptionIv TEXT,
      reencryptionKey TEXT,
      reencryptionDigest TEXT,
      thumbnailPath TEXT,
      thumbnailSize INTEGER,
      thumbnailContentType TEXT,
      thumbnailLocalKey TEXT,
      thumbnailVersion INTEGER,
      screenshotPath TEXT,
      screenshotSize INTEGER,
      screenshotContentType TEXT,
      screenshotLocalKey TEXT,
      screenshotVersion INTEGER,
      backupThumbnailPath TEXT,
      backupThumbnailSize INTEGER,
      backupThumbnailContentType TEXT,
      backupThumbnailLocalKey TEXT,
      backupThumbnailVersion INTEGER,
      storyTextAttachmentJson TEXT,
      localBackupPath TEXT,
      flags INTEGER,
      error INTEGER,
      wasTooBig INTEGER,
      isCorrupted INTEGER,
      copiedFromQuotedAttachment INTEGER,
      pending INTEGER,
      backfillError INTEGER,
      PRIMARY KEY (messageId, editHistoryIndex, attachmentType, orderInMessage)
    ) STRICT;
  `)}function Cn(e){e.exec(`
    DROP INDEX IF EXISTS message_attachments_messageId;
    DROP INDEX IF EXISTS message_attachments_plaintextHash;
    DROP INDEX IF EXISTS message_attachments_path;
    DROP INDEX IF EXISTS message_attachments_all_thumbnailPath;
    DROP INDEX IF EXISTS message_attachments_all_screenshotPath;
    DROP INDEX IF EXISTS message_attachments_all_backupThumbnailPath;
  `)}function wn(e){e.exec(`
    CREATE TABLE donationReceipts(
      id TEXT NOT NULL PRIMARY KEY,
      currencyType TEXT NOT NULL,
      paymentAmount INTEGER NOT NULL,
      paymentDetailJson TEXT NOT NULL,
      paymentType TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    ) STRICT;

    CREATE INDEX donationReceipts_byTimestamp on donationReceipts(timestamp);
  `)}function Tn(e){e.exec(`
      ALTER TABLE attachment_downloads
          RENAME COLUMN digest TO attachmentSignature;
  `),e.exec(`
    ALTER TABLE message_attachments
      DROP COLUMN iv;
    ALTER TABLE message_attachments
      DROP COLUMN isReencryptableToSameDigest;
    ALTER TABLE message_attachments
      DROP COLUMN reencryptionIv;
    ALTER TABLE message_attachments
      DROP COLUMN reencryptionKey;
    ALTER TABLE message_attachments
      DROP COLUMN reencryptionDigest;
    ALTER TABLE message_attachments
      DROP COLUMN backupMediaName;
  `),e.exec(`
    UPDATE message_attachments
      SET backupCdnNumber = NULL;
  `)}function En(e){e.exec(`
    ALTER TABLE donationReceipts DROP COLUMN paymentDetailJson;
    ALTER TABLE donationReceipts DROP COLUMN paymentType;
  `)}function Dn(e){e.exec(`
    UPDATE conversations
      SET json = json_remove(json,
        '$.wallpaperPreset',
        '$.wallpaperPhotoPointerBase64',
        '$.dimWallpaperInDarkMode',
        '$.autoBubbleColor'
      );

    DELETE FROM items
      WHERE id IN (
        'defaultWallpaperPhotoPointer',
        'defaultWallpaperPreset',
        'defaultDimWallpaperInDarkMode',
        'defaultAutoBubbleColor'
      );
  `)}t.Jt();function On(e){e.exec(`
    ALTER TABLE attachment_downloads
      ADD COLUMN originalSource TEXT NOT NULL DEFAULT ${t.Ht.STANDARD};

    UPDATE attachment_downloads
      SET originalSource = source;
  `),e.exec(`
    CREATE TABLE attachment_downloads_backup_stats (
      id INTEGER PRIMARY KEY CHECK (id = 0),
      totalBytes INTEGER NOT NULL,
      completedBytes INTEGER NOT NULL
    ) STRICT;

    INSERT INTO attachment_downloads_backup_stats
      (id, totalBytes, completedBytes)
      VALUES
      (0, 0, 0);

    CREATE TRIGGER attachment_downloads_backup_job_insert
      AFTER INSERT ON attachment_downloads
      WHEN NEW.originalSource = 'backup_import'
      BEGIN
        UPDATE attachment_downloads_backup_stats SET
          totalBytes = totalBytes + NEW.ciphertextSize;
      END;

    CREATE TRIGGER attachment_downloads_backup_job_update
      AFTER UPDATE OF ciphertextSize ON attachment_downloads
      WHEN NEW.originalSource = 'backup_import'
      BEGIN
        UPDATE attachment_downloads_backup_stats SET
          totalBytes = MAX(0, totalBytes - OLD.ciphertextSize + NEW.ciphertextSize)
        WHERE id = 0;
      END;

    CREATE TRIGGER attachment_downloads_backup_job_delete
      AFTER DELETE ON attachment_downloads
      WHEN OLD.originalSource = 'backup_import'
      BEGIN
        UPDATE attachment_downloads_backup_stats SET
          completedBytes = completedBytes + OLD.ciphertextSize
        WHERE id = 0;
      END;
  `)}function kn(e){e.exec(`
    ALTER TABLE callLinks
      ADD COLUMN epoch BLOB;
  `),e.exec(`
    ALTER TABLE defunctCallLinks
      ADD COLUMN epoch BLOB;
  `)}t.cn();function An(e){let[n]=t.mn`
    CREATE TABLE chatFolders (
      id TEXT NOT NULL PRIMARY KEY,
      folderType INTEGER NOT NULL,
      name TEXT NOT NULL,
      position INTEGER NOT NULL,
      showOnlyUnread INTEGER NOT NULL,
      showMutedChats INTEGER NOT NULL,
      includeAllIndividualChats INTEGER NOT NULL,
      includeAllGroupChats INTEGER NOT NULL,
      includedConversationIds TEXT NOT NULL,
      excludedConversationIds TEXT NOT NULL,
      deletedAtTimestampMs INTEGER NOT NULL,
      storageID TEXT,
      storageVersion INTEGER,
      storageUnknownFields BLOB,
      storageNeedsSync INTEGER NOT NULL
    ) STRICT;

    CREATE INDEX chatFolders_by_position on chatFolders (position);
  `;e.exec(n)}function jn(e){e.exec(`
    ALTER TABLE message_attachments
      ADD COLUMN messageType TEXT;
    ALTER TABLE message_attachments
      ADD COLUMN receivedAt INTEGER;
    ALTER TABLE message_attachments
      ADD COLUMN receivedAtMs INTEGER;
    ALTER TABLE message_attachments
      ADD COLUMN isViewOnce INTEGER;
  `),e.exec(`
    UPDATE message_attachments
    SET
      messageType = messages.type,
      receivedAt = messages.received_at,
      receivedAtMs = messages.received_at_ms,
      isViewOnce = messages.isViewOnce
    FROM (
      SELECT id, type, received_at, received_at_ms, isViewOnce
      FROM messages
    ) AS messages
    WHERE
      message_attachments.messageId IS messages.id
  `),e.exec(`
    CREATE INDEX message_attachments_getOlderMedia ON message_attachments
    (conversationId, attachmentType, receivedAt DESC, sentAt DESC)
    WHERE
      editHistoryIndex IS -1 AND
      messageType IN ('incoming', 'outgoing') AND
      isViewOnce IS NOT 1
  `)}function Mn(e){e.exec(`
    ALTER TABLE message_attachments
      ADD COLUMN duration REAL;
  `)}function Nn(e){e.exec(`
    CREATE TABLE kyberPreKey_triples (
      id TEXT NOT NULL REFERENCES kyberPreKeys(id) ON DELETE CASCADE,
      signedPreKeyId INTEGER NOT NULL,
      baseKey BLOB NOT NULL,
      UNIQUE(id, signedPreKeyId, baseKey) ON CONFLICT FAIL
    ) STRICT;
  `)}t.cn();function Pn(e,n){let[r,i]=t.mn`
    DELETE FROM chatFolders
    WHERE folderType IS 1
    AND id NOT IN (
      SELECT id FROM chatFolders
      WHERE folderType IS 1
      ORDER BY storageVersion DESC
      LIMIT 1
    )
  `,a=e.prepare(r).run(i);n.info(`Removed ${a.changes} duplicate all chats chat folders`)}t.cn();function Fn(e,n){let[r,i]=t.mn`
    DELETE FROM notificationProfiles
    WHERE id != lower(id);
  `,a=e.prepare(r).run(i);n.info(`Removed ${a.changes} notification profiles with non-lowercase ids`)}t.cn();const In=t.mn`
  CREATE TRIGGER messages_on_insert AFTER INSERT ON messages
    WHEN new.isSearchable IS 1
    BEGIN
      INSERT INTO messages_fts
      (rowid, body)
      VALUES
      (new.rowid, new.searchableText);
    END;
`[0],Ln=t.mn`
  CREATE TRIGGER messages_on_update AFTER UPDATE ON messages
    WHEN
      new.isSearchable IS 1 AND old.searchableText IS NOT new.searchableText
    BEGIN
      UPDATE messages_fts SET body = new.searchableText WHERE rowId = new.rowId;
    END;
`[0];function Rn(e){e.exec(`ALTER TABLE messages ADD COLUMN isSearchable INT 
      GENERATED ALWAYS AS (isViewOnce IS NOT 1 AND storyId IS NULL) VIRTUAL;`),e.exec(`
    ALTER TABLE messages ADD COLUMN searchableText TEXT GENERATED ALWAYS AS (
      CASE
        WHEN json->'poll' IS NOT NULL THEN json->'poll'->>'question'
        ELSE body
      END
      ) VIRTUAL;
  `),e.exec(`DROP TRIGGER IF EXISTS messages_on_insert;`),e.exec(In),e.exec(`DROP TRIGGER IF EXISTS messages_on_update;`),e.exec(Ln)}t.cn();function zn(e,n){let[r,i]=t.mn`
    UPDATE chatFolders
    SET
      includeAllIndividualChats = 1,
      includeAllGroupChats = 1,
      storageNeedsSync = 1
    WHERE
      folderType = ${1}
      AND (
        includeAllIndividualChats IS 0
        OR
        includeAllGroupChats IS 0
      )
  `,a=e.prepare(r).run(i);n.info(`Updated ${a.changes} all chats chat folders`)}function Bn(e){e.exec(`
    -- Add hasUnreadPollVotes column to messages table
    ALTER TABLE messages ADD COLUMN hasUnreadPollVotes INTEGER NOT NULL DEFAULT 0;

    -- Create partial index for efficient queries
    -- Only indexes rows where hasUnreadPollVotes = 1
    CREATE INDEX messages_unread_poll_votes ON messages (
      conversationId,
      received_at
    ) WHERE hasUnreadPollVotes = 1 AND type IS 'outgoing';
  `)}function Vn(e){e.exec(`
    ALTER TABLE messages ADD COLUMN hasExpireTimer INTEGER NOT NULL
    GENERATED ALWAYS AS (COALESCE(expireTimer, 0) > 0) VIRTUAL;     
  `)}function Hn(e){e.exec(`DROP INDEX IF EXISTS messages_conversationId_hasExpireTimer_expirationStartTimestamp;`),e.exec(`
    CREATE INDEX messages_conversationId_expirationStartTimestamp
    ON messages (conversationId, expirationStartTimestamp)
    WHERE hasExpireTimer IS 1;
  `)}function Un(e){e.exec(`
    ALTER TABLE messages
      ADD COLUMN hasPreviews INTEGER NOT NULL
      GENERATED ALWAYS AS (
        IFNULL(json_array_length(json, '$.preview'), 0) > 0
      );

    CREATE INDEX messages_hasPreviews
      ON messages (conversationId, received_at DESC, sent_at DESC)
      WHERE
        hasPreviews IS 1 AND
        isViewOnce IS NOT 1 AND
        type IN ('incoming', 'outgoing');
  `)}t.cn();function Wn(e){let[n]=t.mn`
    CREATE TABLE pinnedMessages (
     	id               INTEGER PRIMARY KEY AUTOINCREMENT,
     	conversationId   TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
     	messageId        TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
     	messageSentAt    INTEGER NOT NULL,
     	messageSenderAci TEXT NOT NULL,
     	pinnedByAci      TEXT NOT NULL,
     	pinnedAt         INTEGER NOT NULL,
     	expiresAt        INTEGER,
     	UNIQUE (conversationId, messageId)
    ) STRICT;

    CREATE INDEX pinnedMessages_byConversation
      ON pinnedMessages(
        conversationId,
        pinnedAt DESC,
        messageId
      );

    CREATE INDEX pinnedMessages_byExpiresAt
      ON pinnedMessages(
        expiresAt ASC
      )
      WHERE expiresAt IS NOT NULL;
  `;e.exec(n)}t.cn();function Gn(e,n){let[r,i]=t.mn`
    UPDATE messages 
      SET 
        json = json_remove(json, '$.poll'),
        hasUnreadPollVotes = 0
      WHERE isErased = 1 AND (
        json->'poll' IS NOT NULL OR
        hasUnreadPollVotes IS NOT 0
      )
  `,a=e.prepare(r).run(i);n.info(`Updated ${a.changes} poll messages`)}t.cn();function Kn(e){let[n]=t.mn`
    -- We only need the 'messageId' column
    ALTER TABLE pinnedMessages DROP COLUMN messageSentAt;
    ALTER TABLE pinnedMessages DROP COLUMN messageSenderAci;

    -- We dont need to know who pinned the message
    ALTER TABLE pinnedMessages DROP COLUMN pinnedByAci;
  `;e.exec(n)}t.cn();function qn(e,n){let[r]=t.mn`
      DELETE FROM messages 
      WHERE id IN (
        SELECT messages.id from messages
        INNER JOIN conversations ON messages.conversationId = conversations.id 
        WHERE 
          conversations.type = 'group'
          AND messages.storyId IS NOT NULL  
          AND NOT EXISTS (
            SELECT 1 FROM messages AS messages_exists
            WHERE messages.storyId = messages_exists.id AND messages_exists.isErased IS NOT 1
          )
      )
  `,i=e.prepare(r).run();i.changes>0&&n.warn(`Deleted ${i.changes} group story replies without matching stories`)}t.cn();function Jn(e){let[n]=t.mn`
    CREATE TABLE megaphones (
      id TEXT NOT NULL PRIMARY KEY,
      desktopMinVersion TEXT,
      priority INTEGER NOT NULL,
      dontShowBeforeEpochMs INTEGER NOT NULL,
      dontShowAfterEpochMs INTEGER NOT NULL,
      showForNumberOfDays INTEGER NOT NULL,
      primaryCtaId TEXT,
      secondaryCtaId TEXT,
      primaryCtaDataJson TEXT,
      secondaryCtaDataJson TEXT,
      conditionalId TEXT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      primaryCtaText TEXT,
      secondaryCtaText TEXT,
      imagePath TEXT,
      localeFetched TEXT NOT NULL,
      shownAt INTEGER,
      snoozedAt INTEGER,
      snoozeCount INTEGER NOT NULL,
      isFinished INTEGER NOT NULL
    ) STRICT;
  `;e.exec(n)}t.cn();function Yn(e,n){let[r,i]=t.mn`
    WITH rowsKeepingUsername AS (
      SELECT
        rowId,
        json ->> '$.username' AS username,
        MAX(active_at)
      FROM conversations
      WHERE username IS NOT NULL
      GROUP BY username
    )
    UPDATE conversations AS c
    SET json = json_patch(json, ${JSON.stringify({username:null,needsStorageServiceSync:!0})})
    WHERE json ->> '$.username' IS NOT NULL
      AND c.rowId NOT IN (
        SELECT rowId from rowsKeepingUsername
      );
  `,a=e.prepare(r).run(i);a.changes>0&&n.warn(`Removed duplicate usernames from ${a.changes} conversations`)}function Xn(e){e.exec(`
    ALTER TABLE messages
      ADD COLUMN hasContacts INTEGER NOT NULL
      GENERATED ALWAYS AS (
        IFNULL(json_array_length(json, '$.contact'), 0) > 0
      );

    CREATE INDEX messages_hasContacts
      ON messages (conversationId, received_at DESC, sent_at DESC)
      WHERE
        hasContacts IS 1 AND
        isViewOnce IS NOT 1 AND
        type IN ('incoming', 'outgoing');
  `)}function Zn(e){e.exec(`
    CREATE INDEX message_attachments_sortBiggerMedia ON message_attachments
    (conversationId, attachmentType, size DESC, receivedAt DESC, sentAt DESC)
    WHERE
      editHistoryIndex IS -1 AND
      messageType IN ('incoming', 'outgoing') AND
      isViewOnce IS NOT 1;
  `)}i.Yr(),t.cn();function Qn(e){let[n,r]=t.mn`
    SELECT
      pin.id AS pinMessageId,
      target.sourceServiceId AS targetAuthorAci,
      target.sent_at AS targetSentTimestamp
    FROM messages AS pin
    LEFT JOIN messages AS target
      ON pin.json ->> '$.pinnedMessageId' = target.id
    WHERE pin.type IS 'pinned-message-notification'
  `;return e.prepare(n).all(r)}function $n(e){return e.targetSentTimestamp==null?`target message not found`:e.targetAuthorAci==null?`target message missing sourceServiceId`:i.Xr(e.targetAuthorAci)?null:`target message sourceServiceId is not aci`}function er(e,n){let[r,i]=t.mn`
    UPDATE messages
    SET json = json_patch(json, ${JSON.stringify({pinnedMessageId:null,pinMessage:{targetAuthorAci:n.targetAuthorAci,targetSentTimestamp:n.targetSentTimestamp}})})
    WHERE id = ${n.pinMessageId};
  `;e.prepare(r).run(i)}function tr(e,n){let[r,i]=t.mn`
    DELETE FROM messages
    WHERE id = ${n.pinMessageId};
  `;e.prepare(r).run(i)}function nr(e,t){for(let n of Qn(e)){let r=$n(n);r==null?er(e,n):(tr(e,n),t.warn(`Dropped pin message ${n.pinMessageId} (reason: ${r})`))}}function rr(e){e.exec(`
    CREATE TABLE key_transparency_account_data (
      aci TEXT NOT NULL PRIMARY KEY,
      data BLOB NOT NULL
    ) STRICT;
  `)}function ir(e){e.exec(`
      CREATE TABLE attachments_protected_from_deletion (
        path TEXT NOT NULL,
        UNIQUE (path)
      ) STRICT;
    `),e.exec(`
    CREATE INDEX message_attachments_plaintextHash ON message_attachments (plaintextHash);
  `),e.exec(`
    CREATE INDEX message_attachments_path ON message_attachments (path);
  `),e.exec(`
    CREATE INDEX message_attachments_thumbnailPath ON message_attachments (thumbnailPath);
  `),e.exec(`
    CREATE INDEX message_attachments_screenshotPath ON message_attachments (screenshotPath);
  `),e.exec(`
    CREATE INDEX message_attachments_backupThumbnailPath ON message_attachments (backupThumbnailPath);
  `),e.exec(`
    CREATE TRIGGER stop_protecting_attachments_after_update 
    AFTER UPDATE OF path, thumbnailPath, screenshotPath, backupThumbnailPath 
    ON message_attachments
    WHEN 
      OLD.path IS NOT NEW.path OR
      OLD.thumbnailPath IS NOT NEW.thumbnailPath OR
      OLD.screenshotPath IS NOT NEW.screenshotPath OR
      OLD.backupThumbnailPath IS NOT NEW.backupThumbnailPath
    BEGIN
      DELETE FROM attachments_protected_from_deletion 
      WHERE path IN (NEW.path, NEW.thumbnailPath, NEW.screenshotPath, NEW.backupThumbnailPath);
    END;
  `),e.exec(`
    CREATE TRIGGER stop_protecting_attachments_after_insert 
    AFTER INSERT 
    ON message_attachments
    BEGIN
      DELETE FROM attachments_protected_from_deletion 
      WHERE path IN (NEW.path, NEW.thumbnailPath, NEW.screenshotPath, NEW.backupThumbnailPath);
    END;
  `)}function ar(e){e.exec(`
    DROP TABLE attachments_protected_from_deletion;
    
    CREATE TABLE attachments_protected_from_deletion (
      path TEXT NOT NULL,
      messageId TEXT NOT NULL,
      PRIMARY KEY (path, messageId)
    ) STRICT;
  `),e.exec(`
    DROP TRIGGER stop_protecting_attachments_after_update;
    
    CREATE TRIGGER stop_protecting_attachments_after_update 
    AFTER UPDATE OF path, thumbnailPath, screenshotPath, backupThumbnailPath 
    ON message_attachments
    WHEN 
      OLD.path IS NOT NEW.path OR
      OLD.thumbnailPath IS NOT NEW.thumbnailPath OR
      OLD.screenshotPath IS NOT NEW.screenshotPath OR
      OLD.backupThumbnailPath IS NOT NEW.backupThumbnailPath
    BEGIN
      DELETE FROM attachments_protected_from_deletion 
      WHERE 
        messageId IS NEW.messageId 
        AND path IN (
          NEW.path, 
          NEW.thumbnailPath, 
          NEW.screenshotPath, 
          NEW.backupThumbnailPath
        );
    END;
  `),e.exec(`
    DROP TRIGGER stop_protecting_attachments_after_insert;

    CREATE TRIGGER stop_protecting_attachments_after_insert 
    AFTER INSERT 
    ON message_attachments
    BEGIN
      DELETE FROM attachments_protected_from_deletion 
      WHERE 
        messageId IS NEW.messageId 
        AND path IN (
          NEW.path, 
          NEW.thumbnailPath, 
          NEW.screenshotPath, 
          NEW.backupThumbnailPath
        );
    END;
  `)}t.cn();function or(e){let[n]=t.mn`
    ALTER TABLE callLinks DROP COLUMN epoch;
    ALTER TABLE defunctCallLinks DROP COLUMN epoch;
  `;e.exec(n)}t.Na(),t.sa();const O=t.Pa.string().or(t.Pa.null()).optional().transform(e=>e||void 0),sr=t.Pa.object({e164:O,name:O,profileName:O,profileFamilyName:O,systemGivenName:O,systemFamilyName:O,systemNickname:O,nicknameGivenName:O,nicknameFamilyName:O,username:O}).passthrough();function cr(e,n){let r=e.prepare(`SELECT * FROM conversations`).all(),i=e.prepare(`
    UPDATE conversations
    SET
      json = $json,
      e164 = $e164,
      name = $name,
      profileName = $profileName,
      profileFamilyName = $profileFamilyName
    WHERE
      id is $id
  `),a=0;for(let e of r){let r=t.ha(sr,JSON.parse(e.json));if(!r.success){n.warn(`failed to parse conversation json ${e.id}`,r.error);continue}let o=JSON.stringify(r.data),s=e.e164||null,c=e.name||null,l=e.profileName||null,u=e.profileFamilyName||null;o===e.json&&s===e.e164&&c===e.name&&l===e.profileName&&u===e.profileFamilyName||(a+=1,i.run({id:e.id,json:o,e164:s,name:c,profileName:l,profileFamilyName:u}))}a!==0&&n.warn(`fixed ${a} conversations`)}t.cn();function lr(e,n){let[r,i]=t.mn`
    UPDATE messages AS message
      SET json = json_remove(
        json_set(
          message.json,
          '$.pollTerminateNotification.pollTimestamp',
          COALESCE(
            (
              SELECT poll.timestamp
              FROM messages AS poll
              WHERE poll.id = message.json ->> '$.pollTerminateNotification.pollMessageId'
            ),
            0
          )
        ),
        '$.pollTerminateNotification.pollMessageId'
      )
      WHERE
        message.type IS 'poll-terminate' AND
        message.json -> '$.pollTerminateNotification' IS NOT NULL;
  `,a=e.prepare(r).run(i);n.info(`Updated ${a.changes} poll terminate notifications`)}t.Na(),t.sa();function ur(e){return e?.trim()||void 0}const dr=t.Pa.string().nullish().transform(ur),fr=t.Pa.object({profileName:dr,profileFamilyName:dr}).passthrough();function pr(e,n){let r=e.prepare(`SELECT * FROM conversations`).all(),i=e.prepare(`
    UPDATE conversations
    SET
      json = $json,
      profileName = $profileName,
      profileFamilyName = $profileFamilyName
    WHERE
      id is $id
  `),a=0;for(let e of r){let r=t.ha(fr,JSON.parse(e.json));if(!r.success){n.warn(`failed to parse conversation json ${e.id}`,r.error);continue}let{profileName:o,profileFamilyName:s}=r.data;if(o===(e.profileName??void 0)&&s===(e.profileFamilyName??void 0))continue;let c=JSON.stringify(r.data);a+=1,i.run({id:e.id,json:c,profileName:o??null,profileFamilyName:s??null})}a>0&&n.warn(`fixed ${a} conversation(s)`)}t.cn();function mr(e){let[n]=t.mn`
    UPDATE items
    SET json = json_set(
      json,
      '$.value',
      CASE json_extract(json, '$.value')
        WHEN 'EmojiSkinTone.None' THEN ''
        WHEN 'EmojiSkinTone.Type1' THEN '1F3FB'
        WHEN 'EmojiSkinTone.Type2' THEN '1F3FC'
        WHEN 'EmojiSkinTone.Type3' THEN '1F3FD'
        WHEN 'EmojiSkinTone.Type4' THEN '1F3FE'
        WHEN 'EmojiSkinTone.Type5' THEN '1F3FF'
        ELSE ''
      END
    )
    WHERE id IS 'emojiSkinToneDefault';
  `;e.exec(n)}t.cn();function hr(e){let[n,r]=t.mn`
    SELECT * FROM emojis;
  `;return e.prepare(n).all(r)}function gr(e){if(e.length===0)return[];let n=new Map;for(let[e,r]of Object.entries(t.r))n.set(r.shortName,e);let r=[];for(let t of e){if(t.shortName==null||t.lastUsage==null)continue;let e=n.get(t.shortName);e!=null&&r.push({emoji:e,lastUsedAt:t.lastUsage})}return r}function _r(e){let[n]=t.mn`
    CREATE TABLE recentEmojis (
      emoji TEXT NOT NULL PRIMARY KEY,
      lastUsedAt INTEGER NOT NULL
    ) STRICT;

    CREATE INDEX recentEmojis_order ON recentEmojis (lastUsedAt DESC);
  `;e.exec(n)}function vr(e,t){if(t.length===0)return;let n=e.prepare(`
    INSERT INTO recentEmojis (emoji, lastUsedAt) VALUES ($emoji, $lastUsedAt);
  `);for(let e of t)n.run({emoji:e.emoji,lastUsedAt:e.lastUsedAt})}function yr(e){let[n]=t.mn`
    DROP TABLE emojis;
  `;e.exec(n)}function br(e){_r(e),vr(e,gr(hr(e))),yr(e)}function xr(e){e.exec(`
    DROP TABLE attachments_protected_from_deletion;

    CREATE TABLE attachments_protected_from_deletion (
      path TEXT NOT NULL,
      reuseToken TEXT NOT NULL,
      PRIMARY KEY (path, reuseToken)
    ) STRICT;

    CREATE INDEX attachments_protected_from_deletion_reuseToken
      ON attachments_protected_from_deletion (reuseToken);

    DROP TRIGGER stop_protecting_attachments_after_update;
    DROP TRIGGER stop_protecting_attachments_after_insert;
  `)}t.Na(),t.cn(),i.ti(),t.Y(),t._t(),t.Oa();function Sr(e,n,r,{userDataPath:i}){let a=e.prepare(`
    UPDATE conversations SET
      json = $json,
      members = $members,
      name = $name
    WHERE id = $id;
    `),o=t.B(i),c=t.V(i),l=t.W(i),u=Dr(o),d=Dr(c),f=Dr(l),p=e=>{if(e.type===`group`&&Cr(e)&&e.active_at==null&&e.messagesDeleted&&(e.left||e.terminated)){let r=`cleanConversation(${e.id}/groupv2(${e.groupId})`;n.info(`${r}: Cleaning...`),Er(e).map(f).forEach((e,i)=>{try{(0,s.unlinkSync)(e)}catch(e){n.error(`${r}: Failed to deleft draft file at index ${i}`,t.Aa(e))}}),wr(e).map(u).forEach((e,i)=>{try{(0,s.unlinkSync)(e)}catch(e){n.error(`${r}: Failed to delete avatar file at index ${i}`,t.Aa(e))}}),Tr(e).map(d).forEach((e,i)=>{try{(0,s.unlinkSync)(e)}catch(e){n.error(`${r}: Failed to delete avatar draft index ${i}`,t.Aa(e))}});let i={...e,...Or,...kr},o;o=i.membersV2?i.membersV2.map(e=>e.aci).join(` `):i.members?i.members.join(` `):null,a.run({id:i.id,json:t.un(i),members:o,name:i.name??null})}},m=e.prepare(`
    SELECT json
    FROM conversations
    ORDER BY id ASC;
    `,{pluck:!0}).all().map(e=>t.ln(e));n.info(`About to iterate through ${m.length} conversations`);for(let e of m)p(e)}function Cr(e){return!!(e.groupVersion===2&&e.groupId&&Buffer.from(e.groupId,`base64`).byteLength===32)}function wr(e){let{avatar:t,profileAvatar:n}=e,r=[];return t&&t.path&&r.push(t.path),n&&n.path&&r.push(n.path),r}function Tr(e){let{avatars:t}=e,n=[];return(t||[]).forEach(e=>{e.imagePath&&n.push(e.imagePath)}),n}function Er(e){let t=e.draftAttachments||[],n=[];return(t||[]).forEach(e=>{if(e.pending)return;let{path:t,screenshotPath:r}=e;t&&n.push(t),r&&n.push(r)}),n}const Dr=e=>n=>{let r=(0,a.normalize)((0,a.join)(e,n));if(!t.vt(r,e))throw Error(`Invalid relative path`);return r};t.Pa.string().brand(`mimeType`);const Or={draftChanged:void 0,draftAttachments:void 0,draftBodyRanges:void 0,draftIsViewOnce:void 0,draftTimestamp:void 0,inbox_position:void 0,lastMessageDeletedForEveryone:void 0,lastMessageDeletedForEveryoneByAdminAci:void 0,lastMessageAuthorAci:void 0,lastMessage:void 0,lastMessageBodyRanges:void 0,lastMessagePrefix:void 0,lastMessageAuthor:void 0,lastMessageStatus:void 0,lastMessageReceivedAt:void 0,lastMessageReceivedAtMs:void 0,markedUnread:void 0,messageCount:void 0,messageCountBeforeMessageRequests:void 0,messageRequestResponseType:void 0,messagesDeleted:!0,quotedMessageId:void 0,sentMessageCount:void 0,timestamp:void 0,unreadCount:void 0,unreadMentionsCount:void 0,active_at:void 0,draft:void 0,draftEditMessage:void 0,isArchived:void 0,pendingUniversalTimer:void 0},kr={addedBy:void 0,color:void 0,colorFromPrimary:void 0,conversationColor:void 0,customColor:void 0,customColorId:void 0,wallpaperPhotoPointerBase64:void 0,wallpaperPreset:void 0,dimWallpaperInDarkMode:void 0,autoBubbleColor:void 0,hideStory:void 0,isReported:void 0,name:void 0,profileSharing:void 0,pendingUniversalTimer:void 0,pendingRemovedContactNotification:void 0,reportingToken:void 0,left:void 0,storySendMode:void 0,groupVerifiedNameHash:void 0,members:void 0,derivedGroupV2Id:void 0,secretParams:void 0,publicParams:void 0,revision:void 0,senderKeyInfo:void 0,accessControl:void 0,announcementsOnly:void 0,terminated:void 0,avatar:void 0,avatars:void 0,description:void 0,expireTimer:void 0,expireTimerVersion:1,membersV2:void 0,pendingMembersV2:void 0,pendingAdminApprovalV2:void 0,bannedMembersV2:void 0,groupInviteLinkPassword:void 0,previousGroupV1Id:void 0,previousGroupV1Members:void 0,acknowledgedGroupNameCollisions:void 0,isTemporary:void 0,temporaryMemberCount:void 0,unblurredAvatarPath:void 0,remoteAvatarUrl:void 0};function Ar(e){e.exec(`
    INSERT INTO messages_fts(messages_fts) VALUES('rebuild');
  `)}t.cn();function jr(e,n){let[r,i]=t.mn`
      UPDATE messages
      SET json = json_remove(json, '$.storyReplyContext.attachment')
      WHERE isStory = 0

      /* we want to find all messages with a non-null storyId, but using string 
      comparison (instead of a non-null check) here causes Sqlite to use the 
      storyId index */
      AND storyId > '0'
      
      AND json->'$.storyReplyContext.attachment' IS NOT NULL;
  `,a=e.prepare(r).run(i);n.info(`updateToSchemaVersion1760: removed storyReplyContext.attachment from ${a.changes} message(s)`)}t.cn(),t.Oa();const k=`items`,Mr=`blocked`,Nr=`blocked-uuids`,Pr=`blocked-groups`;function Fr(e,n){let r=`updateToSchemaVersion1770`;try{let n=t.nn(e,k,Mr);n?.value&&t.en(e,k,{id:Mr,value:n.value.map(e=>({e164:e,blockedAt:void 0}))})}catch(e){n.error(`${r}: Failed to update '${Mr}' item`,t.Aa(e))}try{let n=t.nn(e,k,Nr);n?.value&&t.en(e,k,{id:Nr,value:n.value.map(e=>({serviceId:e,blockedAt:void 0}))})}catch(e){n.error(`${r}: Failed to update '${Nr}' item`,t.Aa(e))}try{let n=t.nn(e,k,Pr);n?.value&&t.en(e,k,{id:Pr,value:n.value.map(e=>({groupId:e,blockedAt:void 0}))})}catch(e){n.error(`${r}: Failed to update '${Pr}' item`,t.Aa(e))}}function Ir(e){e.exec(`
    INSERT INTO messages_fts(messages_fts) VALUES('rebuild');
  `)}t.cn();function Lr(e){let[n]=t.mn`
    UPDATE conversations
    SET json = json_remove(
      CASE json_extract(json, '$.dontNotifyForMentionsIfMuted')
        WHEN 1 THEN json_set(json, '$.notifyForMentionsIfMuted', json('false'))
        ELSE json
      END,
      '$.dontNotifyForMentionsIfMuted'
    )
    WHERE json_extract(json, '$.dontNotifyForMentionsIfMuted') IS NOT NULL;
  `;e.exec(n)}t.cn();function Rr(e,n){e.exec(`
    ALTER TABLE defunctCallLinks
    ADD COLUMN addedAt INTEGER;
  `);let[r]=t.mn`
    DELETE FROM defunctCallLinks
    WHERE adminKey IS NULL AND storageID IS NULL;
  `,i=e.prepare(r).run();n.info(`updateToSchemaVersion1800: Deleted ${i.changes} defunct call links`);let[a,o]=t.mn`
    UPDATE defunctCallLinks
    SET addedAt = ${Date.now()}, storageNeedsSync = 1
  `,s=e.prepare(a).run(o);n.info(`updateToSchemaVersion1800: Updated ${s.changes} defunct call links`),e.exec(`
    ALTER TABLE defunctCallLinks
    ALTER COLUMN addedAt SET NOT NULL;
  `),e.exec(`
    CREATE INDEX defunctCallLinks_expiring ON defunctCallLinks(addedAt);
  `),e.exec(`
    CREATE INDEX callLinks_expiring ON callLinks(deletedAt);
  `)}t.g(),t.cn(),t.Ii();const{keyBy:zr}=m.default;function Br(e){e.exec(`
    CREATE TABLE messages(
      id STRING PRIMARY KEY ASC,
      json TEXT,

      unread INTEGER,
      expires_at INTEGER,
      sent_at INTEGER,
      schemaVersion INTEGER,
      conversationId STRING,
      received_at INTEGER,
      source STRING,
      sourceDevice STRING,
      hasAttachments INTEGER,
      hasFileAttachments INTEGER,
      hasVisualMediaAttachments INTEGER
    );
    CREATE INDEX messages_unread ON messages (
      unread
    );
    CREATE INDEX messages_expires_at ON messages (
      expires_at
    );
    CREATE INDEX messages_receipt ON messages (
      sent_at
    );
    CREATE INDEX messages_schemaVersion ON messages (
      schemaVersion
    );
    CREATE INDEX messages_conversation ON messages (
      conversationId,
      received_at
    );
    CREATE INDEX messages_duplicate_check ON messages (
      source,
      sourceDevice,
      sent_at
    );
    CREATE INDEX messages_hasAttachments ON messages (
      conversationId,
      hasAttachments,
      received_at
    );
    CREATE INDEX messages_hasFileAttachments ON messages (
      conversationId,
      hasFileAttachments,
      received_at
    );
    CREATE INDEX messages_hasVisualMediaAttachments ON messages (
      conversationId,
      hasVisualMediaAttachments,
      received_at
    );
    CREATE TABLE unprocessed(
      id STRING,
      timestamp INTEGER,
      json TEXT
    );
    CREATE INDEX unprocessed_id ON unprocessed (
      id
    );
    CREATE INDEX unprocessed_timestamp ON unprocessed (
      timestamp
    );
  `)}function Vr(e){e.exec(`
    ALTER TABLE messages
      ADD COLUMN expireTimer INTEGER;

    ALTER TABLE messages
      ADD COLUMN expirationStartTimestamp INTEGER;

    ALTER TABLE messages
      ADD COLUMN type STRING;

    CREATE INDEX messages_expiring ON messages (
      expireTimer,
      expirationStartTimestamp,
      expires_at
    );

    UPDATE messages SET
      expirationStartTimestamp = json_extract(json, '$.expirationStartTimestamp'),
      expireTimer = json_extract(json, '$.expireTimer'),
      type = json_extract(json, '$.type');
  `)}function Hr(e){e.exec(`
    DROP INDEX messages_expiring;
    DROP INDEX messages_unread;

    CREATE INDEX messages_without_timer ON messages (
      expireTimer,
      expires_at,
      type
    ) WHERE expires_at IS NULL AND expireTimer IS NOT NULL;

    CREATE INDEX messages_unread ON messages (
      conversationId,
      unread
    ) WHERE unread IS NOT NULL;

    ANALYZE;
  `)}function Ur(e){e.exec(`
    CREATE TABLE conversations(
      id STRING PRIMARY KEY ASC,
      json TEXT,

      active_at INTEGER,
      type STRING,
      members TEXT,
      name TEXT,
      profileName TEXT
    );
    CREATE INDEX conversations_active ON conversations (
      active_at
    ) WHERE active_at IS NOT NULL;

    CREATE INDEX conversations_type ON conversations (
      type
    ) WHERE type IS NOT NULL;
  `)}function Wr(e){e.exec(`
    -- key-value, ids are strings, one extra column
    CREATE TABLE sessions(
      id STRING PRIMARY KEY ASC,
      number STRING,
      json TEXT
    );
    CREATE INDEX sessions_number ON sessions (
      number
    ) WHERE number IS NOT NULL;
    -- key-value, ids are strings
    CREATE TABLE groups(
      id STRING PRIMARY KEY ASC,
      json TEXT
    );
    CREATE TABLE identityKeys(
      id STRING PRIMARY KEY ASC,
      json TEXT
    );
    CREATE TABLE items(
      id STRING PRIMARY KEY ASC,
      json TEXT
    );
    -- key-value, ids are integers
    CREATE TABLE preKeys(
      id INTEGER PRIMARY KEY ASC,
      json TEXT
    );
    CREATE TABLE signedPreKeys(
      id INTEGER PRIMARY KEY ASC,
      json TEXT
    );
  `)}function Gr(e){e.exec(`
    -- SQLite has been coercing our STRINGs into numbers, so we force it with TEXT
    -- We create a new table then copy the data into it, since we can't modify columns
    DROP INDEX sessions_number;
    ALTER TABLE sessions RENAME TO sessions_old;

    CREATE TABLE sessions(
      id TEXT PRIMARY KEY,
      number TEXT,
      json TEXT
    );
    CREATE INDEX sessions_number ON sessions (
      number
    ) WHERE number IS NOT NULL;
    INSERT INTO sessions(id, number, json)
      SELECT '+' || id, number, json FROM sessions_old;
    DROP TABLE sessions_old;
  `)}function Kr(e){e.exec(`
    -- First, we pull a new body field out of the message table's json blob
    ALTER TABLE messages
      ADD COLUMN body TEXT;
    UPDATE messages SET body = json_extract(json, '$.body');

    -- Then we create our full-text search table and populate it
    CREATE VIRTUAL TABLE messages_fts
      USING fts5(id UNINDEXED, body);

    INSERT INTO messages_fts(id, body)
      SELECT id, body FROM messages;

    -- Then we set up triggers to keep the full-text search table up to date
    CREATE TRIGGER messages_on_insert AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts (
        id,
        body
      ) VALUES (
        new.id,
        new.body
      );
    END;
    CREATE TRIGGER messages_on_delete AFTER DELETE ON messages BEGIN
      DELETE FROM messages_fts WHERE id = old.id;
    END;
    CREATE TRIGGER messages_on_update AFTER UPDATE ON messages BEGIN
      DELETE FROM messages_fts WHERE id = old.id;
      INSERT INTO messages_fts(
        id,
        body
      ) VALUES (
        new.id,
        new.body
      );
    END;
  `)}function qr(e){e.exec(`
    CREATE TABLE attachment_downloads(
      id STRING primary key,
      timestamp INTEGER,
      pending INTEGER,
      json TEXT
    );

    CREATE INDEX attachment_downloads_timestamp
      ON attachment_downloads (
        timestamp
    ) WHERE pending = 0;
    CREATE INDEX attachment_downloads_pending
      ON attachment_downloads (
        pending
    ) WHERE pending != 0;
  `)}function Jr(e){e.exec(`
    DROP INDEX unprocessed_id;
    DROP INDEX unprocessed_timestamp;
    ALTER TABLE unprocessed RENAME TO unprocessed_old;

    CREATE TABLE unprocessed(
      id STRING,
      timestamp INTEGER,
      version INTEGER,
      attempts INTEGER,
      envelope TEXT,
      decrypted TEXT,
      source TEXT,
      sourceDevice TEXT,
      serverTimestamp INTEGER
    );

    CREATE INDEX unprocessed_id ON unprocessed (
      id
    );
    CREATE INDEX unprocessed_timestamp ON unprocessed (
      timestamp
    );

    INSERT INTO unprocessed (
      id,
      timestamp,
      version,
      attempts,
      envelope,
      decrypted,
      source,
      sourceDevice,
      serverTimestamp
    ) SELECT
      id,
      timestamp,
      json_extract(json, '$.version'),
      json_extract(json, '$.attempts'),
      json_extract(json, '$.envelope'),
      json_extract(json, '$.decrypted'),
      json_extract(json, '$.source'),
      json_extract(json, '$.sourceDevice'),
      json_extract(json, '$.serverTimestamp')
    FROM unprocessed_old;

    DROP TABLE unprocessed_old;
  `)}function Yr(e){e.exec(`
    DROP TABLE groups;
  `)}function Xr(e){e.exec(`
    CREATE TABLE sticker_packs(
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL,

      author STRING,
      coverStickerId INTEGER,
      createdAt INTEGER,
      downloadAttempts INTEGER,
      installedAt INTEGER,
      lastUsed INTEGER,
      status STRING,
      stickerCount INTEGER,
      title STRING
    );

    CREATE TABLE stickers(
      id INTEGER NOT NULL,
      packId TEXT NOT NULL,

      emoji STRING,
      height INTEGER,
      isCoverOnly INTEGER,
      lastUsed INTEGER,
      path STRING,
      width INTEGER,

      PRIMARY KEY (id, packId),
      CONSTRAINT stickers_fk
        FOREIGN KEY (packId)
        REFERENCES sticker_packs(id)
        ON DELETE CASCADE
    );

    CREATE INDEX stickers_recents
      ON stickers (
        lastUsed
    ) WHERE lastUsed IS NOT NULL;

    CREATE TABLE sticker_references(
      messageId STRING,
      packId TEXT,
      CONSTRAINT sticker_references_fk
        FOREIGN KEY(packId)
        REFERENCES sticker_packs(id)
        ON DELETE CASCADE
    );
  `)}function Zr(e){e.exec(`
    ALTER TABLE sticker_packs ADD COLUMN attemptedStatus STRING;
  `)}function Qr(e){e.exec(`
    CREATE TABLE emojis(
      shortName STRING PRIMARY KEY,
      lastUsage INTEGER
    );

    CREATE INDEX emojis_lastUsage
      ON emojis (
        lastUsage
    );
  `)}function $r(e){e.exec(`
    -- SQLite has again coerced our STRINGs into numbers, so we force it with TEXT
    -- We create a new table then copy the data into it, since we can't modify columns

    DROP INDEX emojis_lastUsage;
    ALTER TABLE emojis RENAME TO emojis_old;

    CREATE TABLE emojis(
      shortName TEXT PRIMARY KEY,
      lastUsage INTEGER
    );
    CREATE INDEX emojis_lastUsage
      ON emojis (
        lastUsage
    );

    DELETE FROM emojis WHERE shortName = 1;
    INSERT INTO emojis(shortName, lastUsage)
      SELECT shortName, lastUsage FROM emojis_old;

    DROP TABLE emojis_old;
  `)}function ei(e){e.exec(`
    ALTER TABLE messages
    ADD COLUMN messageTimer INTEGER;
    ALTER TABLE messages
    ADD COLUMN messageTimerStart INTEGER;
    ALTER TABLE messages
    ADD COLUMN messageTimerExpiresAt INTEGER;
    ALTER TABLE messages
    ADD COLUMN isErased INTEGER;

    CREATE INDEX messages_message_timer ON messages (
      messageTimer,
      messageTimerStart,
      messageTimerExpiresAt,
      isErased
    ) WHERE messageTimer IS NOT NULL;

    -- Updating full-text triggers to avoid anything with a messageTimer set

    DROP TRIGGER messages_on_insert;
    DROP TRIGGER messages_on_delete;
    DROP TRIGGER messages_on_update;

    CREATE TRIGGER messages_on_insert AFTER INSERT ON messages
    WHEN new.messageTimer IS NULL
    BEGIN
      INSERT INTO messages_fts (
        id,
        body
      ) VALUES (
        new.id,
        new.body
      );
    END;
    CREATE TRIGGER messages_on_delete AFTER DELETE ON messages BEGIN
      DELETE FROM messages_fts WHERE id = old.id;
    END;
    CREATE TRIGGER messages_on_update AFTER UPDATE ON messages
    WHEN new.messageTimer IS NULL
    BEGIN
      DELETE FROM messages_fts WHERE id = old.id;
      INSERT INTO messages_fts(
        id,
        body
      ) VALUES (
        new.id,
        new.body
      );
    END;
  `)}function ti(e,t){try{e.exec(`
      ALTER TABLE messages
      ADD COLUMN isViewOnce INTEGER;

      DROP INDEX messages_message_timer;
    `)}catch{t.info(`Message table already had isViewOnce column`)}e.exec(`DROP INDEX IF EXISTS messages_view_once;`),e.exec(`
    CREATE INDEX messages_view_once ON messages (
      isErased
    ) WHERE isViewOnce = 1;

    -- Updating full-text triggers to avoid anything with isViewOnce = 1

    DROP TRIGGER messages_on_insert;
    DROP TRIGGER messages_on_update;

    CREATE TRIGGER messages_on_insert AFTER INSERT ON messages
    WHEN new.isViewOnce != 1
    BEGIN
      INSERT INTO messages_fts (
        id,
        body
      ) VALUES (
        new.id,
        new.body
      );
    END;
    CREATE TRIGGER messages_on_update AFTER UPDATE ON messages
    WHEN new.isViewOnce != 1
    BEGIN
      DELETE FROM messages_fts WHERE id = old.id;
      INSERT INTO messages_fts(
        id,
        body
      ) VALUES (
        new.id,
        new.body
      );
    END;
  `)}function ni(e){e.exec(`
    -- Delete and rebuild full-text search index to capture everything

    DELETE FROM messages_fts;
    INSERT INTO messages_fts(messages_fts) VALUES('rebuild');

    INSERT INTO messages_fts(id, body)
    SELECT id, body FROM messages WHERE isViewOnce IS NULL OR isViewOnce != 1;

    -- Fixing full-text triggers

    DROP TRIGGER messages_on_insert;
    DROP TRIGGER messages_on_update;

    CREATE TRIGGER messages_on_insert AFTER INSERT ON messages
    WHEN new.isViewOnce IS NULL OR new.isViewOnce != 1
    BEGIN
      INSERT INTO messages_fts (
        id,
        body
      ) VALUES (
        new.id,
        new.body
      );
    END;
    CREATE TRIGGER messages_on_update AFTER UPDATE ON messages
    WHEN new.isViewOnce IS NULL OR new.isViewOnce != 1
    BEGIN
      DELETE FROM messages_fts WHERE id = old.id;
      INSERT INTO messages_fts(
        id,
        body
      ) VALUES (
        new.id,
        new.body
      );
    END;
  `)}function ri(e){e.exec(`
    ALTER TABLE conversations
    ADD COLUMN profileFamilyName TEXT;
    ALTER TABLE conversations
    ADD COLUMN profileFullName TEXT;

    -- Preload new field with the profileName we already have
    UPDATE conversations SET profileFullName = profileName;
  `)}function ii(e){let n=e.prepare(`SELECT * FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'messages'`).all();for(let t of n)e.exec(`DROP TRIGGER ${t.name}`);e.exec(`
    ALTER TABLE conversations ADD COLUMN e164 TEXT;
    ALTER TABLE conversations ADD COLUMN uuid TEXT;
    ALTER TABLE conversations ADD COLUMN groupId TEXT;
    ALTER TABLE messages ADD COLUMN sourceUuid TEXT;
    ALTER TABLE sessions RENAME COLUMN number TO conversationId;
    CREATE INDEX conversations_e164 ON conversations(e164);
    CREATE INDEX conversations_uuid ON conversations(uuid);
    CREATE INDEX conversations_groupId ON conversations(groupId);
    CREATE INDEX messages_sourceUuid on messages(sourceUuid);

    -- Migrate existing IDs
    UPDATE conversations SET e164 = '+' || id WHERE type = 'private';
    UPDATE conversations SET groupId = id WHERE type = 'group';
  `);let r=e.prepare(`SELECT * FROM conversations WHERE type = 'group' AND members IS NULL;`).all();for(let t of r){let n=JSON.parse(t.json);(!n.members||!n.members.length)&&(e.prepare(`DELETE FROM conversations WHERE id = $id;`).run({id:n.id}),e.prepare(`DELETE FROM messages WHERE conversationId = $id;`).run({id:n.id}))}let i=e.prepare(`SELECT * FROM conversations;`).all(),a=zr(i,`id`);for(let n of i){let r=n.id,i=t.v();a[r].id=i;let o={id:i};n.type===`private`?o.e164=`+${r}`:n.type===`group`&&(o.groupId=r);let s=JSON.stringify(o);e.prepare(`
      UPDATE conversations
      SET id = $newId, json = JSON_PATCH(json, $patch)
      WHERE id = $oldId
      `).run({newId:i,oldId:r,patch:s});let c=JSON.stringify({conversationId:i});e.prepare(`
      UPDATE messages
      SET conversationId = $newId, json = JSON_PATCH(json, $patch)
      WHERE conversationId = $oldId
      `).run({newId:i,oldId:r,patch:c})}e.prepare(`
      SELECT id, members, json FROM conversations WHERE type = 'group';
      `).all().forEach(n=>{let r=n.members.split(/\s?\+/).filter(Boolean),i=[];for(let n of r){let r=a[n];if(r)i.push(r.id);else{let r=t.v(),a={id:r,e164:n,type:`private`,version:2,unreadCount:0,verified:0,inbox_position:0,isPinned:!1,lastMessageDeletedForEveryone:!1,markedUnread:!1,messageCount:0,sentMessageCount:0,profileSharing:!1};e.prepare(`
          UPDATE conversations
          SET
            json = $json,
            e164 = $e164,
            type = $type
          WHERE
            id = $id;
          `).run({id:a.id,json:t.un(a),e164:a.e164,type:a.type}),i.push(r)}}let o={...t.ln(n.json),members:i},s=i.join(` `);e.prepare(`
      UPDATE conversations
      SET members = $newMembersValue, json = $newJsonValue
      WHERE id = $id
      `).run({id:n.id,newMembersValue:s,newJsonValue:t.un(o)})});let o=e.prepare(`SELECT * FROM sessions;`).all();for(let n of o){let r=JSON.parse(n.json),i=a[r.number.substr(1)];i&&(r.conversationId=i.id,r.id=`${r.conversationId}.${r.deviceId}`),delete r.number,e.prepare(`
      UPDATE sessions
      SET id = $newId, json = $newJson, conversationId = $newConversationId
      WHERE id = $oldId
      `).run({newId:r.id,newJson:t.un(r),oldId:n.id,newConversationId:r.conversationId})}let s=e.prepare(`SELECT * FROM identityKeys;`).all();for(let n of s){let r=JSON.parse(n.json);r.id=a[r.id],e.prepare(`
      UPDATE identityKeys
      SET id = $newId, json = $newJson
      WHERE id = $oldId
      `).run({newId:r.id,newJson:t.un(r),oldId:n.id})}for(let t of n)e.exec(t.sql)}function ai(e){e.exec(`
    UPDATE conversations
    SET json = json_set(
      json,
      '$.messageCount',
      (SELECT count(*) FROM messages WHERE messages.conversationId = conversations.id)
    );
    UPDATE conversations
    SET json = json_set(
      json,
      '$.sentMessageCount',
      (SELECT count(*) FROM messages WHERE messages.conversationId = conversations.id AND messages.type = 'outgoing')
    );
  `)}function oi(e){e.exec(`
    ALTER TABLE unprocessed
      ADD COLUMN sourceUuid STRING;
  `)}function si(e){e.exec(`
    -- Remove triggers which keep full-text search up to date
    DROP TRIGGER messages_on_insert;
    DROP TRIGGER messages_on_update;
    DROP TRIGGER messages_on_delete;
  `)}function ci(e){e.exec(`
    ALTER TABLE conversations
    ADD COLUMN profileLastFetchedAt INTEGER;
  `)}function li(e){e.exec(`
    ALTER TABLE messages
    RENAME TO old_messages
  `);for(let t of[`messages_expires_at`,`messages_receipt`,`messages_schemaVersion`,`messages_conversation`,`messages_duplicate_check`,`messages_hasAttachments`,`messages_hasFileAttachments`,`messages_hasVisualMediaAttachments`,`messages_without_timer`,`messages_unread`,`messages_view_once`,`messages_sourceUuid`])e.exec(`DROP INDEX IF EXISTS ${t};`);e.exec(`
    --
    -- Create a new table with a different primary key
    --

    CREATE TABLE messages(
      rowid INTEGER PRIMARY KEY ASC,
      id STRING UNIQUE,
      json TEXT,
      unread INTEGER,
      expires_at INTEGER,
      sent_at INTEGER,
      schemaVersion INTEGER,
      conversationId STRING,
      received_at INTEGER,
      source STRING,
      sourceDevice STRING,
      hasAttachments INTEGER,
      hasFileAttachments INTEGER,
      hasVisualMediaAttachments INTEGER,
      expireTimer INTEGER,
      expirationStartTimestamp INTEGER,
      type STRING,
      body TEXT,
      messageTimer INTEGER,
      messageTimerStart INTEGER,
      messageTimerExpiresAt INTEGER,
      isErased INTEGER,
      isViewOnce INTEGER,
      sourceUuid TEXT);

    -- Create index in lieu of old PRIMARY KEY
    CREATE INDEX messages_id ON messages (id ASC);

    --
    -- Recreate indices
    --

    CREATE INDEX messages_expires_at ON messages (expires_at);

    CREATE INDEX messages_receipt ON messages (sent_at);

    CREATE INDEX messages_schemaVersion ON messages (schemaVersion);

    CREATE INDEX messages_conversation ON messages
      (conversationId, received_at);

    CREATE INDEX messages_duplicate_check ON messages
      (source, sourceDevice, sent_at);

    CREATE INDEX messages_hasAttachments ON messages
      (conversationId, hasAttachments, received_at);

    CREATE INDEX messages_hasFileAttachments ON messages
      (conversationId, hasFileAttachments, received_at);

    CREATE INDEX messages_hasVisualMediaAttachments ON messages
      (conversationId, hasVisualMediaAttachments, received_at);

    CREATE INDEX messages_without_timer ON messages
      (expireTimer, expires_at, type)
      WHERE expires_at IS NULL AND expireTimer IS NOT NULL;

    CREATE INDEX messages_unread ON messages
      (conversationId, unread) WHERE unread IS NOT NULL;

    CREATE INDEX messages_view_once ON messages
      (isErased) WHERE isViewOnce = 1;

    CREATE INDEX messages_sourceUuid on messages(sourceUuid);

    -- New index for searchMessages
    CREATE INDEX messages_searchOrder on messages(received_at, sent_at);

    --
    -- Re-create messages_fts and add triggers
    --

    DROP TABLE messages_fts;

    CREATE VIRTUAL TABLE messages_fts USING fts5(body);

    CREATE TRIGGER messages_on_insert AFTER INSERT ON messages
    WHEN new.isViewOnce IS NULL OR new.isViewOnce != 1
    BEGIN
      INSERT INTO messages_fts
      (rowid, body)
      VALUES
      (new.rowid, new.body);
    END;

    CREATE TRIGGER messages_on_delete AFTER DELETE ON messages BEGIN
      DELETE FROM messages_fts WHERE rowid = old.rowid;
    END;

    CREATE TRIGGER messages_on_update AFTER UPDATE ON messages
    WHEN new.isViewOnce IS NULL OR new.isViewOnce != 1
    BEGIN
      DELETE FROM messages_fts WHERE rowid = old.rowid;
      INSERT INTO messages_fts
      (rowid, body)
      VALUES
      (new.rowid, new.body);
    END;

    --
    -- Copy data over
    --

    INSERT INTO messages
    (
      id, json, unread, expires_at, sent_at, schemaVersion, conversationId,
      received_at, source, sourceDevice, hasAttachments, hasFileAttachments,
      hasVisualMediaAttachments, expireTimer, expirationStartTimestamp, type,
      body, messageTimer, messageTimerStart, messageTimerExpiresAt, isErased,
      isViewOnce, sourceUuid
    )
    SELECT
      id, json, unread, expires_at, sent_at, schemaVersion, conversationId,
      received_at, source, sourceDevice, hasAttachments, hasFileAttachments,
      hasVisualMediaAttachments, expireTimer, expirationStartTimestamp, type,
      body, messageTimer, messageTimerStart, messageTimerExpiresAt, isErased,
      isViewOnce, sourceUuid
    FROM old_messages;

    -- Drop old database
    DROP TABLE old_messages;
  `)}function ui(e){e.exec(`
    DROP TRIGGER messages_on_insert;
    DROP TRIGGER messages_on_update;

    CREATE TRIGGER messages_on_insert AFTER INSERT ON messages
    WHEN new.isViewOnce IS NULL OR new.isViewOnce != 1
    BEGIN
      INSERT INTO messages_fts
      (rowid, body)
      VALUES
      (new.rowid, new.body);
    END;

    CREATE TRIGGER messages_on_update AFTER UPDATE ON messages
    WHEN new.body != old.body AND
      (new.isViewOnce IS NULL OR new.isViewOnce != 1)
    BEGIN
      DELETE FROM messages_fts WHERE rowid = old.rowid;
      INSERT INTO messages_fts
      (rowid, body)
      VALUES
      (new.rowid, new.body);
    END;
  `)}function di(e){e.exec(`
    DELETE FROM messages_fts WHERE rowid IN
      (SELECT rowid FROM messages WHERE body IS NULL);

    DROP TRIGGER messages_on_update;

    CREATE TRIGGER messages_on_update AFTER UPDATE ON messages
    WHEN
      new.body IS NULL OR
      ((old.body IS NULL OR new.body != old.body) AND
       (new.isViewOnce IS NULL OR new.isViewOnce != 1))
    BEGIN
      DELETE FROM messages_fts WHERE rowid = old.rowid;
      INSERT INTO messages_fts
      (rowid, body)
      VALUES
      (new.rowid, new.body);
    END;

    CREATE TRIGGER messages_on_view_once_update AFTER UPDATE ON messages
    WHEN
      new.body IS NOT NULL AND new.isViewOnce = 1
    BEGIN
      DELETE FROM messages_fts WHERE rowid = old.rowid;
    END;
  `)}function fi(e){e.exec(`
    CREATE TABLE jobs(
      id TEXT PRIMARY KEY,
      queueType TEXT STRING NOT NULL,
      timestamp INTEGER NOT NULL,
      data STRING TEXT
    );

    CREATE INDEX jobs_timestamp ON jobs (timestamp);
  `)}function pi(e){e.exec(`
    CREATE TABLE reactions(
      conversationId STRING,
      emoji STRING,
      fromId STRING,
      messageReceivedAt INTEGER,
      targetAuthorUuid STRING,
      targetTimestamp INTEGER,
      unread INTEGER
    );

    CREATE INDEX reactions_unread ON reactions (
      unread,
      conversationId
    );

    CREATE INDEX reaction_identifier ON reactions (
      emoji,
      targetAuthorUuid,
      targetTimestamp
    );
  `)}function mi(e){e.exec(`
    CREATE TABLE senderKeys(
      id TEXT PRIMARY KEY NOT NULL,
      senderId TEXT NOT NULL,
      distributionId TEXT NOT NULL,
      data BLOB NOT NULL,
      lastUpdatedDate NUMBER NOT NULL
    );
  `)}function hi(e){e.exec(`
    DROP INDEX unprocessed_id;
    DROP INDEX unprocessed_timestamp;
    ALTER TABLE unprocessed RENAME TO unprocessed_old;

    CREATE TABLE unprocessed(
      id STRING PRIMARY KEY ASC,
      timestamp INTEGER,
      version INTEGER,
      attempts INTEGER,
      envelope TEXT,
      decrypted TEXT,
      source TEXT,
      sourceDevice TEXT,
      serverTimestamp INTEGER,
      sourceUuid STRING
    );

    CREATE INDEX unprocessed_timestamp ON unprocessed (
      timestamp
    );

    INSERT OR REPLACE INTO unprocessed
      (id, timestamp, version, attempts, envelope, decrypted, source,
       sourceDevice, serverTimestamp, sourceUuid)
    SELECT
      id, timestamp, version, attempts, envelope, decrypted, source,
       sourceDevice, serverTimestamp, sourceUuid
    FROM unprocessed_old;

    DROP TABLE unprocessed_old;
  `)}function gi(e){e.exec(`
    ALTER TABLE messages
    ADD COLUMN serverGuid STRING NULL;

    ALTER TABLE unprocessed
    ADD COLUMN serverGuid STRING NULL;
  `)}function _i(e){e.exec(`
    -- These indexes should exist, but we add "IF EXISTS" for safety.
    DROP INDEX IF EXISTS messages_expires_at;
    DROP INDEX IF EXISTS messages_without_timer;

    ALTER TABLE messages
    ADD COLUMN
    expiresAt INT
    GENERATED ALWAYS
    AS (expirationStartTimestamp + (expireTimer * 1000));

    CREATE INDEX message_expires_at ON messages (
      expiresAt
    );

    CREATE INDEX outgoing_messages_without_expiration_start_timestamp ON messages (
      expireTimer, expirationStartTimestamp, type
    )
    WHERE expireTimer IS NOT NULL AND expirationStartTimestamp IS NULL;
  `)}function vi(e){e.exec(`
    -- This index should exist, but we add "IF EXISTS" for safety.
    DROP INDEX IF EXISTS outgoing_messages_without_expiration_start_timestamp;

    CREATE INDEX messages_unexpectedly_missing_expiration_start_timestamp ON messages (
      expireTimer, expirationStartTimestamp, type
    )
    WHERE expireTimer IS NOT NULL AND expirationStartTimestamp IS NULL;
  `)}function yi(e){e.exec(`
    CREATE INDEX expiring_message_by_conversation_and_received_at
    ON messages
    (
      expirationStartTimestamp,
      expireTimer,
      conversationId,
      received_at
    );
  `)}function bi(){}function xi(e){e.exec(`
    -- Create send log primary table

    CREATE TABLE sendLogPayloads(
      id INTEGER PRIMARY KEY ASC,

      timestamp INTEGER NOT NULL,
      contentHint INTEGER NOT NULL,
      proto BLOB NOT NULL
    );

    CREATE INDEX sendLogPayloadsByTimestamp ON sendLogPayloads (timestamp);

    -- Create send log recipients table with foreign key relationship to payloads

    CREATE TABLE sendLogRecipients(
      payloadId INTEGER NOT NULL,

      recipientUuid STRING NOT NULL,
      deviceId INTEGER NOT NULL,

      PRIMARY KEY (payloadId, recipientUuid, deviceId),

      CONSTRAINT sendLogRecipientsForeignKey
        FOREIGN KEY (payloadId)
        REFERENCES sendLogPayloads(id)
        ON DELETE CASCADE
    );

    CREATE INDEX sendLogRecipientsByRecipient
      ON sendLogRecipients (recipientUuid, deviceId);

    -- Create send log messages table with foreign key relationship to payloads

    CREATE TABLE sendLogMessageIds(
      payloadId INTEGER NOT NULL,

      messageId STRING NOT NULL,

      PRIMARY KEY (payloadId, messageId),

      CONSTRAINT sendLogMessageIdsForeignKey
        FOREIGN KEY (payloadId)
        REFERENCES sendLogPayloads(id)
        ON DELETE CASCADE
    );

    CREATE INDEX sendLogMessageIdsByMessage
      ON sendLogMessageIds (messageId);

    -- Recreate messages table delete trigger with send log support

    DROP TRIGGER messages_on_delete;

    CREATE TRIGGER messages_on_delete AFTER DELETE ON messages BEGIN
      DELETE FROM messages_fts WHERE rowid = old.rowid;
      DELETE FROM sendLogPayloads WHERE id IN (
        SELECT payloadId FROM sendLogMessageIds
        WHERE messageId = old.id
      );
    END;

    --- Add messageId column to reactions table to properly track proto associations

    ALTER TABLE reactions ADD column messageId STRING;
  `)}function Si(e){e.exec(`
    DROP INDEX IF EXISTS messages_duplicate_check;

    ALTER TABLE messages
      RENAME COLUMN sourceDevice TO deprecatedSourceDevice;
    ALTER TABLE messages
      ADD COLUMN sourceDevice INTEGER;

    UPDATE messages
    SET
      sourceDevice = CAST(deprecatedSourceDevice AS INTEGER),
      deprecatedSourceDevice = NULL;

    ALTER TABLE unprocessed
      RENAME COLUMN sourceDevice TO deprecatedSourceDevice;
    ALTER TABLE unprocessed
      ADD COLUMN sourceDevice INTEGER;

    UPDATE unprocessed
    SET
      sourceDevice = CAST(deprecatedSourceDevice AS INTEGER),
      deprecatedSourceDevice = NULL;
  `)}function Ci(e){e.exec(`ALTER TABLE messages RENAME COLUMN unread TO readStatus;`)}function wi(e){e.exec(`
    CREATE TABLE groupCallRings(
      ringId INTEGER PRIMARY KEY,
      isActive INTEGER NOT NULL,
      createdAt INTEGER NOT NULL
    );
    `)}const A=[{version:1,update:Br},{version:2,update:Vr},{version:3,update:Hr},{version:4,update:Ur},{version:6,update:Wr},{version:7,update:Gr},{version:8,update:Kr},{version:9,update:qr},{version:10,update:Jr},{version:11,update:Yr},{version:12,update:Xr},{version:13,update:Zr},{version:14,update:Qr},{version:15,update:$r},{version:16,update:ei},{version:17,update:ti},{version:18,update:ni},{version:19,update:ri},{version:20,update:ii},{version:21,update:ai},{version:22,update:oi},{version:23,update:si},{version:24,update:ci},{version:25,update:li},{version:26,update:ui},{version:27,update:di},{version:28,update:fi},{version:29,update:pi},{version:30,update:mi},{version:31,update:hi},{version:32,update:gi},{version:33,update:_i},{version:34,update:vi},{version:35,update:yi},{version:36,update:bi},{version:37,update:xi},{version:38,update:Si},{version:39,update:Ci},{version:40,update:wi},{version:41,update:_},{version:42,update:v},{version:43,update:b},{version:44,update:x},{version:45,update:S},{version:46,update:ee},{version:47,update:te},{version:48,update:C},{version:49,update:ne},{version:50,update:re},{version:51,update:ie},{version:52,update:ae},{version:53,update:oe},{version:54,update:se},{version:55,update:ce},{version:56,update:le},{version:57,update:ue},{version:58,update:de},{version:59,update:fe},{version:60,update:w},{version:61,update:pe},{version:62,update:me},{version:63,update:he},{version:64,update:ge},{version:65,update:_e},{version:66,update:ve},{version:67,update:ye},{version:68,update:be},{version:69,update:xe},{version:70,update:Se},{version:71,update:Ce},{version:72,update:we},{version:73,update:Te},{version:74,update:Ee},{version:75,update:De},{version:76,update:Oe},{version:77,update:ke},{version:78,update:Ae},{version:79,update:je},{version:80,update:Me},{version:81,update:Ne},{version:82,update:Pe},{version:83,update:Fe},{version:84,update:Ie},{version:85,update:Le},{version:86,update:Re},{version:87,update:Ve},{version:88,update:He},{version:89,update:ot},{version:90,update:ct},{version:91,update:lt},{version:920,update:ze},{version:930,update:ut},{version:940,update:dt},{version:950,update:ft},{version:960,update:pt},{version:970,update:_t},{version:980,update:vt},{version:990,update:yt},{version:1e3,update:Ct},{version:1010,update:wt},{version:1020,update:Tt},{version:1030,update:Et},{version:1040,update:Ot},{version:1050,update:kt},{version:1060,update:At},{version:1070,update:jt},{version:1080,update:Mt},{version:1090,update:Nt},{version:1100,update:Pt},{version:1110,update:Ft},{version:1120,update:It},{version:1130,update:Lt},{version:1140,update:Rt},{version:1150,update:zt},{version:1160,update:Ht},{version:1170,update:Ut},{version:1180,update:Wt},{version:1190,update:Gt},{version:1200,update:Kt},{version:1210,update:qt},{version:1220,update:cn},{version:1230,update:ln},{version:1240,update:un},{version:1250,update:dn},{version:1260,update:fn},{version:1270,update:pn},{version:1280,update:mn},{version:1290,update:hn},{version:1300,update:gn},{version:1310,update:_n},{version:1320,update:vn},{version:1330,update:yn},{version:1340,update:bn},{version:1350,update:xn},{version:1360,update:Sn},{version:1370,update:Cn},{version:1380,update:wn},{version:1390,update:Tn},{version:1400,update:En},{version:1410,update:Dn},{version:1420,update:On},{version:1430,update:kn},{version:1440,update:An},{version:1450,update:jn},{version:1460,update:Mn},{version:1470,update:Nn},{version:1480,update:Pn},{version:1490,update:Fn},{version:1500,update:Rn},{version:1510,update:zn},{version:1520,update:Bn},{version:1530,update:Vn},{version:1540,update:Hn},{version:1550,update:Un},{version:1560,update:Wn},{version:1561,update:Gn},{version:1570,update:Kn},{version:1580,update:qn},{version:1590,update:Jn},{version:1600,update:Yn},{version:1610,update:Xn},{version:1620,update:Zn},{version:1630,update:nr},{version:1640,update:rr},{version:1650,update:ir},{version:1660,update:ar},{version:1670,update:or},{version:1680,update:cr},{version:1690,update:lr},{version:1700,update:pr},{version:1710,update:mr},{version:1720,update:br},{version:1730,update:xr},{version:1740,update:Sr},{version:1750,update:Ar},{version:1760,update:jr},{version:1770,update:Fr},{version:1780,update:Ir},{version:1790,update:Lr},{version:1800,update:Rr}];var Ti=class extends Error{name=`DBVersionFromFutureError`};function Ei(e,t){e.prepare(`
      SELECT v FROM messages_fts_config WHERE k is 'secure-delete';
    `,{pluck:!0}).get()!==1&&(t.info(`enableFTS5SecureDelete: enabling`),e.exec(`
      -- Enable secure-delete
      INSERT INTO messages_fts
      (messages_fts, rank)
      VALUES
      ('secure-delete', 1);
    `))}function Di(e,n,r){let i=t.an(e),a=t.in(e),o=t.sn(e),s=t.on(e),c=A[A.length-1]?.version;t.Ri(c,`Missing MAX_VERSION`);for(let e=1;e<A.length;e+=1){let n=A[e-1]?.version,r=A[e]?.version;if(t.Ri(n,`Missing prev`),t.Ri(r,`Missing next`),n>=r)throw Error(`Migration versions are not monotonic: ${n} >= ${r}`)}if(n.info(`updateSchema:
`,` Current user_version: ${o};\n`,` Most recent db schema: ${c};\n`,` SQLite version: ${i};\n`,` SQLCipher version: ${a};\n`,` (deprecated) schema_version: ${s};\n`),o>c)throw new Ti(`SQL: User version is ${o} but the expected maximum version is ${c}.`);let l=0;for(;l<A.length;)e.transaction(()=>{for(;l<A.length;l+=1){let i=A[l];t.Ri(i,`Missing schema`);let{version:a,update:s}=i;if(a<=o)continue;let c=n.child(`updateSchema(${a})`);if(s(e,c,o,r)===`vacuum`)return c.info(`success, needs vacuum`),e.pragma(`user_version = ${a}`),l+=1,!0;c.info(`success`)}return e.pragma(`user_version = ${c}`),!1})()&&(n.info(`running vacuum`),e.exec(`VACUUM`),n.info(`done running vacuum`));if(Ro.ensureMessageInsertTriggersAreEnabled(e),Ei(e,n),o!==c){let t=Date.now();e.pragma(`optimize`);let r=Date.now()-t;n.info(`updateSchema: optimize took ${r}ms`)}}t.cn(),t.Qi(),t.Ii();const{groupBy:Oi}=m.default,ki=n.t(`hydrateMessage`);function Ai(e){if(e!=null)return e===1}function j(e,t){return M(e,[t])[0]}function M(e,t){return Ni(e,t.map(e=>{let t={...ji(e),hasAttachments:e.hasAttachments===1,hasFileAttachments:e.hasFileAttachments===1,hasVisualMediaAttachments:e.hasVisualMediaAttachments===1};return e.hasUnreadPollVotes===1?{...t,hasUnreadPollVotes:!0}:t}))}function ji(e){let{json:n,id:r,body:i,conversationId:a,expirationStartTimestamp:o,expireTimer:s,isErased:c,isViewOnce:l,mentionsMe:u,received_at:d,received_at_ms:f,schemaVersion:p,serverGuid:m,sent_at:h,source:g,sourceServiceId:_,sourceDevice:v,storyId:y,type:b,readStatus:x,seenStatus:S,timestamp:ee,serverTimestamp:te,unidentifiedDeliveryReceived:C}=e;return{...JSON.parse(n),id:r,body:t.u(i),conversationId:a||``,expirationStartTimestamp:t.u(o),expireTimer:t.u(s),isErased:Ai(c),isViewOnce:Ai(l),mentionsMe:Ai(u),received_at:d||0,received_at_ms:t.u(f),schemaVersion:t.u(p),serverGuid:t.u(m),sent_at:h||0,source:t.u(g),sourceServiceId:t.u(_),sourceDevice:t.u(v),storyId:t.u(y),type:b,readStatus:x??void 0,seenStatus:S??void 0,timestamp:ee||0,serverTimestamp:t.u(te),unidentifiedDeliveryReceived:Ai(C)}}function Mi(e,n){return t.Xt(e,n,(n,r)=>{let[i,a]=t.mn`
      SELECT * FROM message_attachments
      WHERE messageId IN (${t.vn(n)});
    `;return e.prepare(i,{persistent:r}).all(a)})}function Ni(e,n){let r=Oi(Mi(e,n.map(e=>e.id)),`messageId`);return n.map(e=>{let{hasAttachments:n,hasFileAttachments:i,hasVisualMediaAttachments:a,...o}=e,s=r[o.id]??[];if(!s.length)return o.attachments?.length||o.isErased||o.deletedForEveryone||o.isViewOnce||o.type!==`incoming`&&o.type!==`outgoing`||!n&&!i&&!a?o:(ki.warn(`Retrieved message that should have attachments but missing message_attachment rows, timestamp: ${o.timestamp}`),{...o,attachments:[{error:!0,size:0,width:a?150:void 0,height:a?150:void 0,contentType:a?t.Gi:t.zi}]});let c=Oi(s,`editHistoryIndex`),l=Pi(o,c[-1]??[]);return l.editHistory&&=l.editHistory.map((e,t)=>Pi(e,c[t]??[])),l})}function Pi(e,t){let n=Oi(t,`attachmentType`),r=n.attachment??[],i=n[`long-message`]??[],a=n.quote??[],o=n.preview??[],s=n.contact??[],c=(n.sticker??[]).find(e=>e.orderInMessage===0),l=structuredClone(e);return r.length&&(l.attachments=r.sort((e,t)=>e.orderInMessage-t.orderInMessage).map(N)),i[0]&&(l.bodyAttachment=N(i[0])),l.quote?.attachments.forEach((e,t)=>{let n=a.find(e=>e.orderInMessage===t);n&&(e.thumbnail=N(n))}),l.preview?.forEach((e,t)=>{let n=o.find(e=>e.orderInMessage===t);n&&(e.image=N(n))}),l.contact?.forEach((e,t)=>{let n=s.find(e=>e.orderInMessage===t);n&&e.avatar&&(e.avatar.avatar=N(n))}),l.sticker&&c&&(l.sticker.data=N(c)),l}function N(e){let n=t.p(e);t.Ri(n!=null,`must exist`);let{clientUuid:r,size:i,duration:a,contentType:o,plaintextHash:s,path:c,localKey:l,caption:u,blurHash:d,height:f,width:p,digest:m,key:h,downloadPath:g,flags:_,fileName:v,version:y,incrementalMac:b,incrementalMacChunkSize:x,transitCdnKey:S,transitCdnNumber:ee,transitCdnUploadTimestamp:te,error:C,pending:ne,wasTooBig:re,isCorrupted:ie,backfillError:ae,storyTextAttachmentJson:oe,copiedFromQuotedAttachment:se,localBackupPath:ce}=n;return{clientUuid:r,size:i,duration:a,contentType:t.aa(o),plaintextHash:s,path:c,localKey:l,caption:u,blurHash:d,height:f,width:p,digest:m,key:h,downloadPath:g,localBackupPath:ce,flags:_,fileName:v,version:y,incrementalMac:b,chunkSize:x,cdnKey:S,cdnNumber:ee,uploadTimestamp:te,pending:t.$t(ne),error:t.$t(C),wasTooBig:t.$t(re),copied:t.$t(se),isCorrupted:t.$t(ie),backfillError:t.$t(ae),textAttachment:oe?t.ln(oe):void 0,backupCdnNumber:n.backupCdnNumber,...n.thumbnailPath?{thumbnail:{path:n.thumbnailPath,size:n.thumbnailSize??0,contentType:n.thumbnailContentType?t.aa(n.thumbnailContentType):t.Wi,localKey:n.thumbnailLocalKey,version:n.thumbnailVersion}}:{},...n.screenshotPath?{screenshot:{path:n.screenshotPath,size:n.screenshotSize??0,contentType:n.screenshotContentType?t.aa(n.screenshotContentType):t.Wi,localKey:n.screenshotLocalKey,version:n.screenshotVersion}}:{},...n.backupThumbnailPath?{thumbnailFromBackup:{path:n.backupThumbnailPath,size:n.backupThumbnailSize??0,contentType:n.backupThumbnailContentType?t.aa(n.backupThumbnailContentType):t.Wi,localKey:n.backupThumbnailLocalKey,version:n.backupThumbnailVersion}}:{}}}t.Na(),t.bn(),t.Qi();const Fi=t.Qa({type:t.Ja(`standard`),mediaName:t.to(),data:t.Qa({path:t.to(),size:t.Za(),contentType:t.Ji,keys:t.to(),transitCdnInfo:t.Qa({cdnKey:t.to(),cdnNumber:t.Za(),uploadTimestamp:t.Za().optional()}).optional(),version:t.no([t.Ja(1),t.Ja(2)]).optional(),localKey:t.to().optional()})}),Ii=t.to().refine(e=>e.endsWith(`_thumbnail`)),Li=t.Qa({type:t.Ja(`thumbnail`),mediaName:Ii,data:t.Qa({fullsizePath:t.to(),fullsizeSize:t.Za(),contentType:t.Ji,version:t.no([t.Ja(1),t.Ja(2)]).optional(),localKey:t.to().optional()})}),Ri=t.Qa({receivedAt:t.Za()}).and(t.Ka(`type`,[Fi,Li])).and(t.xn);t.xa(),i.mr(),t.bi(),i.Z(),i.H(),i.S(),t.cn(),t.Ii(),i.Ot(),t.sa();function zi(e,n){let[r,i]=t.mn`
    SELECT 1
    FROM callLinks
    WHERE roomId = ${n};
  `;return e.prepare(r,{pluck:!0}).get(i)===1}function Bi(e,t){let n=Vi(e,t);if(n)return i.f(n)}function Vi(e,n){let r=e.prepare(`SELECT * FROM callLinks WHERE roomId = $roomId`).get({roomId:n});if(r)return t.da(i.J,r)}function Hi(e){let[n]=t.mn`
    SELECT * FROM callLinks;
  `;return e.prepare(n).all().map(e=>i.f(t.da(i.J,e)))}function Ui(e,t){let{roomId:n,rootKey:r}=t;Yi(n,r);let a=i.h(t);e.prepare(`
    INSERT INTO callLinks (
      roomId,
      rootKey,
      adminKey,
      name,
      restrictions,
      revoked,
      expiration,
      storageID,
      storageVersion,
      storageUnknownFields,
      storageNeedsSync
    ) VALUES (
      $roomId,
      $rootKey,
      $adminKey,
      $name,
      $restrictions,
      $revoked,
      $expiration,
      $storageID,
      $storageVersion,
      $storageUnknownFields,
      $storageNeedsSync
    )
    `).run(a)}function Wi(e,t){Ui(e,t)}function Gi(e,t){let{roomId:n,adminKey:r}=t;return e.transaction(()=>{let i=Bi(e,n);return i?r&&r!==i.adminKey?(Ji(e,n,r),{callLink:{...i,adminKey:r},inserted:!1,updated:!0}):{callLink:i,inserted:!1,updated:!1}:(Wi(e,t),{callLink:t,inserted:!0,updated:!1})})()}function Ki(e,t){let{roomId:n,rootKey:r}=t;Yi(n,r);let a=i.h(t);e.prepare(`
    UPDATE callLinks
    SET
      adminKey = $adminKey,
      name = $name,
      restrictions = $restrictions,
      revoked = $revoked,
      expiration = $expiration,
      storageID = $storageID,
      storageVersion = $storageVersion,
      storageUnknownFields = $storageUnknownFields,
      storageNeedsSync = $storageNeedsSync
    WHERE roomId = $roomId
    `).run(a)}function qi(e,n,r){let{name:a,restrictions:o,expiration:s,revoked:c}=r,[l,u]=t.mn`
    UPDATE callLinks
    SET
      name = ${a},
      restrictions = ${t.ua(i.Y,o)},
      expiration = ${s},
      revoked = ${+!!c}
    WHERE roomId = ${n}
    RETURNING *;
  `,d=e.prepare(l).get(u);return t.Ri(d,`Expected row to be returned`),i.f(t.da(i.J,d))}function Ji(e,t,n){let r=i.W(n);e.prepare(`
     UPDATE callLinks
     SET adminKey = $adminKeyBytes
     WHERE roomId = $roomId;
     `).run({roomId:t,adminKeyBytes:r})}function Yi(e,n){let r=f.CallLinkRootKey.parse(n).deriveRoomId();t.Ri(e===t.Oi(r),`passed roomId must match roomId derived from root key`)}function Xi(e,n){let[r,a]=t.mn`
    UPDATE callsHistory
    SET
      status = ${i.mt.Deleted},
      timestamp = ${Date.now()}
    WHERE peerId = ${n}
  `;e.prepare(r).run(a)}function Zi(e,n,r){return e.transaction(()=>{let[i,a]=t.mn`
      DELETE FROM callLinks
      WHERE (adminKey IS NULL AND storageID IS NULL)
      AND roomId = ${n};
    `;if(e.prepare(i).run(a).changes!==0)return!1;let[o,s]=t.mn`
        UPDATE callLinks
        SET
          deleted = 1,
          deletedAt = ${r},
          storageNeedsSync = 1
        WHERE (adminKey IS NOT NULL OR storageID IS NOT NULL)
        AND deleted IS NOT 1
        AND roomId = ${n};
      `;return e.prepare(o).run(s).changes>0})()}function Qi(e,n){e.transaction(()=>{let[r,a]=t.mn`
      DELETE FROM callLinks
        WHERE roomId = ${n};
    `;e.prepare(r).run(a);let[o,s]=t.mn`
      UPDATE callsHistory
      SET
        status = ${i._t.Deleted},
        timestamp = ${Date.now()}
      WHERE peerId = ${n};
    `;e.prepare(o).run(s)})()}function $i(e){let n=new Date().getTime();return e.transaction(()=>{let[r,i]=t.mn`
        UPDATE callLinks
        SET
          deleted = 1,
          deletedAt = ${n},
          storageNeedsSync = 1
        WHERE (adminKey IS NOT NULL OR storageID IS NOT NULL)
        AND deleted IS NOT 1;
      `,a=e.prepare(r).run(i),[o]=t.mn`
      DELETE FROM callLinks
      WHERE (adminKey IS NULL AND storageID IS NULL);
    `;return e.prepare(o).run(),a.changes>0})()}function ea(e){let[n]=t.mn`
    SELECT * FROM callLinks
    WHERE
      (adminKey IS NOT NULL OR storageID IS NOT NULL)
      AND rootKey IS NOT NULL;
  `;return e.prepare(n).all().map(e=>t.da(i.J,e))}function ta(e){return ea(e).map(e=>i.f(e))}function na(e){let[n,r]=t.mn`
    DELETE FROM callLinks;
  `;e.prepare(n).run(r)}function ra(e){let[n]=t.mn`
    SELECT *
    FROM defunctCallLinks
    WHERE (adminKey IS NOT NULL OR storageID IS NOT NULL);
  `;return e.prepare(n).all().map(e=>i.g(t.da(i.X,e)))}function ia(e,n){let[r,a]=t.mn`
    SELECT *
    FROM defunctCallLinks
    WHERE roomId = ${n}
  `,o=e.prepare(r).get(a);if(o)return i.g(t.da(i.X,o))}function aa(e,t){let{roomId:n,rootKey:r}=t;Yi(n,r);let a=i._(t);e.prepare(`
    INSERT INTO defunctCallLinks (
      roomId,
      rootKey,
      adminKey,
      addedAt,
      storageID,
      storageVersion,
      storageUnknownFields,
      storageNeedsSync
    ) VALUES (
      $roomId,
      $rootKey,
      $adminKey,
      $addedAt,
      $storageID,
      $storageVersion,
      $storageUnknownFields,
      $storageNeedsSync
    )
    ON CONFLICT (roomId) DO NOTHING;
    `).run(a)}function oa(e,t){let{roomId:n,rootKey:r}=t;Yi(n,r);let a=i._(t);e.prepare(`
    UPDATE defunctCallLinks
    SET
      addedAt = $addedAt,
      storageID = $storageID,
      storageVersion = $storageVersion,
      storageUnknownFields = $storageUnknownFields,
      storageNeedsSync = $storageNeedsSync
    WHERE roomId = $roomId
    `).run(a)}function sa(e){let[n,r]=t.mn`
    SELECT roomId, addedAt FROM defunctCallLinks
    ORDER BY addedAt ASC
    LIMIT 1
  `;return e.prepare(n).get(r)}function ca(e,n){let[r,i]=t.mn`
    DELETE FROM defunctCallLinks
    WHERE roomId = ${n}
  `;return e.prepare(r).run(i).changes>0}function la(e,n){let[r,i]=t.mn`
    DELETE FROM defunctCallLinks
    WHERE addedAt < ${Date.now()-n}
    RETURNING roomId
  `;return e.prepare(r,{pluck:!0}).all(i)}function ua(e){let[n,r]=t.mn`
    SELECT roomId, deletedAt FROM callLinks
    WHERE deletedAt > 0
    ORDER BY deletedAt ASC
    LIMIT 1
  `;return e.prepare(n).get(r)}function da(e,n){let[r,i]=t.mn`
    DELETE FROM callLinks
    WHERE roomId = ${n}
  `;return e.prepare(r).run(i).changes>0}function fa(e,n){let[r,i]=t.mn`
    DELETE FROM callLinks
    WHERE deletedAt > 0
      AND deletedAt < ${Date.now()-n}
    RETURNING roomId
  `;return e.prepare(r,{pluck:!0}).all(i)}t.cn();function pa(e){return e.prepare(`SELECT * FROM donationReceipts ORDER BY timestamp DESC;`).all()}function ma(e,n){let[r,i]=t.mn`SELECT * FROM donationReceipts WHERE id = ${n}`;return e.prepare(r).get(i)}function ha(e){e.prepare(`DELETE FROM donationReceipts;`).run()}function ga(e,n){let[r,i]=t.mn`DELETE FROM donationReceipts WHERE id = ${n};`;e.prepare(r).run(i)}function _a(e,t){e.prepare(`
      INSERT INTO donationReceipts(
        id,
        currencyType,
        paymentAmount,
        timestamp
      ) VALUES (
        $id,
        $currencyType,
        $paymentAmount,
        $timestamp
      );
      `).run(t)}i.tn(),t.cn(),t.Ii(),t.sa();function va(e,t){e.transaction(()=>{let{combinedEndorsement:n,memberEndorsements:r}=t,{groupId:i}=n;ya(e,i),ba(e,n),xa(e,r)})()}function ya(e,n){let[r,i]=t.mn`
    DELETE FROM groupSendCombinedEndorsement
    WHERE groupId = ${n};
  `,[a,o]=t.mn`
    DELETE FROM groupSendMemberEndorsement
    WHERE groupId IS ${n};
  `;e.prepare(r).run(i),e.prepare(a).run(o)}function ba(e,n){let{groupId:r,expiration:i,endorsement:a}=n,[o,s]=t.mn`
    INSERT OR REPLACE INTO groupSendCombinedEndorsement
    (groupId, expiration, endorsement)
    VALUES (${r}, ${i}, ${a});
  `;t.Ri(e.prepare(o).run(s).changes===1,`Must update groupSendCombinedEndorsement`)}function xa(e,n){for(let r of n){let{groupId:n,memberAci:i,expiration:a,endorsement:o}=r,[s,c]=t.mn`
      INSERT OR REPLACE INTO groupSendMemberEndorsement
      (groupId, memberAci, expiration, endorsement)
      VALUES (${n}, ${i}, ${a}, ${o});
    `;t.Ri(e.prepare(s).run(c).changes===1,`Must update groupSendMemberEndorsement`)}}function Sa(e,t){e.transaction(()=>{ya(e,t)})()}function Ca(e,n){let[r,a]=t.mn`
    SELECT expiration FROM groupSendCombinedEndorsement
    WHERE groupId IS ${n};
  `,o=e.prepare(r,{pluck:!0}).get(a);return o==null?null:t.da(i.Qt,o)}function wa(e,n){return e.transaction(()=>{let[r,a]=t.mn`
      SELECT * FROM groupSendCombinedEndorsement
      WHERE groupId IS ${n}
    `,[o,s]=t.mn`
      SELECT * FROM groupSendMemberEndorsement
      WHERE groupId IS ${n}
    `,c=e.prepare(r).get(a);return c==null?null:t.ca(i.$t,{combinedEndorsement:c,memberEndorsements:e.prepare(o).all(s)})})()}function Ta(e,n,r){let[a,o]=t.mn`
    SELECT * FROM groupSendMemberEndorsement
    WHERE groupId IS ${n}
    AND memberAci IS ${r}
  `,s=e.prepare(a).get(o);return s==null?null:t.da(i.en,s)}t.g(),i.Bt(),t.cn(),t.Ii(),i.jt();function Ea(e){return{...e,showOnlyUnread:+!!e.showOnlyUnread,showMutedChats:+!!e.showMutedChats,includeAllIndividualChats:+!!e.includeAllIndividualChats,includeAllGroupChats:+!!e.includeAllGroupChats,includedConversationIds:JSON.stringify(e.includedConversationIds),excludedConversationIds:JSON.stringify(e.excludedConversationIds),storageNeedsSync:+!!e.storageNeedsSync}}function Da(e){return{...e,showOnlyUnread:e.showOnlyUnread===1,showMutedChats:e.showMutedChats===1,includeAllIndividualChats:e.includeAllIndividualChats===1,includeAllGroupChats:e.includeAllGroupChats===1,includedConversationIds:JSON.parse(e.includedConversationIds),excludedConversationIds:JSON.parse(e.excludedConversationIds),storageNeedsSync:e.storageNeedsSync===1}}function Oa(e){let[n,r]=t.mn`
    SELECT * FROM chatFolders
  `;return e.prepare(n).all(r).map(e=>Da(e))}function ka(e){let[n,r]=t.mn`
    SELECT *
    FROM chatFolders
    WHERE folderType IS NOT ${i.zt.UNKNOWN}
    AND deletedAtTimestampMs IS 0
    ORDER BY position ASC
  `;return e.prepare(n).all(r).map(e=>{let n=Da(e);return t.Ri(i.Nt(n),`Query returned row that is not a current chat folder (${n.id})`),n})}function Aa(e,n){let[r,i]=t.mn`
    SELECT * FROM chatFolders
    WHERE id = ${n};
  `,a=e.prepare(r).get(i);return a==null?null:Da(a)}function ja(e,n){let r=Ea(n),[i,a]=t.mn`
    INSERT INTO chatFolders (
      id,
      folderType,
      name,
      position,
      showOnlyUnread,
      showMutedChats,
      includeAllIndividualChats,
      includeAllGroupChats,
      includedConversationIds,
      excludedConversationIds,
      deletedAtTimestampMs,
      storageID,
      storageVersion,
      storageUnknownFields,
      storageNeedsSync
    ) VALUES (
      ${r.id},
      ${r.folderType},
      ${r.name},
      ${r.position},
      ${r.showOnlyUnread},
      ${r.showMutedChats},
      ${r.includeAllIndividualChats},
      ${r.includeAllGroupChats},
      ${r.includedConversationIds},
      ${r.excludedConversationIds},
      ${r.deletedAtTimestampMs},
      ${r.storageID},
      ${r.storageVersion},
      ${r.storageUnknownFields},
      ${r.storageNeedsSync}
    )
  `;e.prepare(i).run(a)}function Ma(e,t){return e.transaction(()=>{ja(e,t)})()}function Na(e){let[n,r]=t.mn`
    SELECT EXISTS (
      SELECT 1 FROM chatFolders
      WHERE folderType IS ${i.zt.ALL}
      AND deletedAtTimestampMs IS 0
      LIMIT 1
    )
  `;return e.prepare(n,{pluck:!0}).get(r)===1}function Pa(e){return e.transaction(()=>{let n={id:t.v(),...i.Pt,position:0,deletedAtTimestampMs:0,storageID:null,storageVersion:null,storageUnknownFields:null,storageNeedsSync:!0};return Ba(e,1),ja(e,n),n})()}function Fa(e,n){return e.transaction(()=>{if(t.Ri(n.folderType===i.zt.ALL,`Chat folder must have folderType=ALL`),Na(e)){let r=Ea(n),[a,o]=t.mn`
        UPDATE chatFolders
        SET
          id = ${r.id},
          position = ${r.position},
          storageID = ${r.storageID},
          storageVersion = ${r.storageVersion},
          storageUnknownFields = ${r.storageUnknownFields},
          storageNeedsSync = ${r.storageNeedsSync}
        WHERE
          folderType = ${i.zt.ALL}
      `;e.prepare(a).run(o)}else ja(e,n)})()}function Ia(e,n){let r=Ea(n),[i,a]=t.mn`
    UPDATE chatFolders
    SET
      id = ${r.id},
      folderType = ${r.folderType},
      name = ${r.name},
      position = ${r.position},
      showOnlyUnread = ${r.showOnlyUnread},
      showMutedChats = ${r.showMutedChats},
      includeAllIndividualChats = ${r.includeAllIndividualChats},
      includeAllGroupChats = ${r.includeAllGroupChats},
      includedConversationIds = ${r.includedConversationIds},
      excludedConversationIds = ${r.excludedConversationIds},
      deletedAtTimestampMs = ${r.deletedAtTimestampMs},
      storageID = ${r.storageID},
      storageVersion = ${r.storageVersion},
      storageUnknownFields = ${r.storageUnknownFields},
      storageNeedsSync = ${r.storageNeedsSync}
    WHERE
      id = ${r.id}
  `;e.prepare(i).run(a)}function La(e,n,r,i){return e.transaction(()=>{let a=Aa(e,n);t.Ri(a!=null,`Missing chat folder for id: ${n}`);let o=new Set(a.includedConversationIds),s=new Set(a.excludedConversationIds);i?(o.add(r),s.delete(r)):(o.delete(r),s.add(r)),Ia(e,{...a,includedConversationIds:Array.from(o),excludedConversationIds:Array.from(s),storageNeedsSync:!0})})()}const Ra=JSON.stringify([]);function za(e,n,r,a){return e.transaction(()=>{let[o,s]=t.mn`
      UPDATE chatFolders
      SET
        position = ${i.It},
        deletedAtTimestampMs = ${r},
        storageNeedsSync = ${+!!a},
        includedConversationIds = ${Ra},
        excludedConversationIds = ${Ra}
      WHERE id = ${n}
    `;e.prepare(o).run(s),Ba(e,0)})()}function Ba(e,n){let[r,i]=t.mn`
    SELECT id FROM chatFolders
    WHERE deletedAtTimestampMs IS 0
    ORDER BY position ASC
  `;e.prepare(r,{pluck:!0}).all(i).forEach((r,i)=>{let[a,o]=t.mn`
        UPDATE chatFolders
        SET
          position = ${n+i},
          storageNeedsSync = 1
        WHERE id = ${r}
      `;e.prepare(a).run(o)})}function Va(e,n){return e.transaction(()=>{for(let r of n){let[n,i]=t.mn`
        UPDATE chatFolders
        SET
          position = ${r.position},
          storageNeedsSync = 1
        WHERE id = ${r.id}
      `;e.prepare(n).run(i)}})()}function Ha(e,n,r){return e.transaction(()=>{let[i,a]=t.mn`
      UPDATE chatFolders
      SET deletedAtTimestampMs = ${r}
      WHERE id = ${n}
    `;e.prepare(i).run(a)})()}function Ua(e){let[n,r]=t.mn`
    SELECT *
    FROM chatFolders
    WHERE deletedAtTimestampMs > 0
    ORDER BY deletedAtTimestampMs ASC
    LIMIT 1
  `,i=e.prepare(n).get(r);return i==null?null:Da(i)}function Wa(e,n){let[r,i]=t.mn`
    DELETE FROM chatFolders
    WHERE deletedAtTimestampMs > 0
      AND deletedAtTimestampMs < ${Date.now()-n}
    RETURNING id
  `;return e.prepare(r,{pluck:!0}).all(i)}function Ga(e,n){let[r,i]=t.mn`
    DELETE FROM chatFolders
    WHERE id = ${n}
  `;e.prepare(r).run(i)}t.Ii(),t.cn();function Ka(e,n){let[r,i]=t.mn`
    SELECT * FROM messages
    WHERE id = ${n}
  `,a=e.prepare(r).get(i);return a==null?null:j(e,a)}function qa(e,n){let r=Ka(e,n.messageId);return t.Ri(r!=null,`Missing message ${n.messageId} for pinned message ${n.id}`),{pinnedMessage:n,message:r}}function Ja(e){let[n,r]=t.mn`
    SELECT * FROM pinnedMessages;
  `;return e.prepare(n).all(r)}function Ya(e,n){return e.transaction(()=>{let[r,i]=t.mn`
      SELECT * FROM pinnedMessages
      WHERE conversationId = ${n}
      ORDER BY pinnedAt ASC
    `;return e.prepare(r).all(i).map(t=>qa(e,t))})()}function Xa(e,n){let[r,i]=t.mn`
    SELECT * FROM pinnedMessages
    WHERE messageId IS ${n}
  `;return e.prepare(r).get(i)??null}function Za(e,n){let[r,i]=t.mn`
    INSERT INTO pinnedMessages (
      conversationId,
      messageId,
      pinnedAt,
      expiresAt
    ) VALUES (
      ${n.conversationId},
      ${n.messageId},
      ${n.pinnedAt},
      ${n.expiresAt}
    )
    RETURNING *;
  `,a=e.prepare(r).get(i);return t.Ri(a!=null,`createPinnedMessage: Failed to insert`),a}function Qa(e,n){let[r,i]=t.mn`
    DELETE FROM pinnedMessages
    WHERE id = ${n}
  `,a=e.prepare(r).run(i);t.Ri(a.changes===1,`deletePinnedMessage: Expected changes: 1, Actual: ${a.changes}`)}function $a(e,n,r){let[i,a]=t.mn`
    DELETE FROM pinnedMessages
    WHERE conversationId = ${n}
    AND id NOT IN (
      SELECT id FROM pinnedMessages
      WHERE conversationId = ${n}
      ORDER BY pinnedAt DESC
      LIMIT ${r}
    )
    RETURNING id
  `;return e.prepare(i,{pluck:!0}).all(a)}function eo(e,t,n){return e.transaction(()=>{let r=Xa(e,n.messageId),i;i=r==null?!0:n.pinnedAt>r.pinnedAt;let a=null;if(i){let t=null;r!=null&&(Qa(e,r.id),t=r.id),a={inserted:Za(e,n),replaced:t}}let o=$a(e,n.conversationId,t);return{change:a,truncated:o}})()}function to(e,n){let[r,i]=t.mn`
    DELETE FROM pinnedMessages
    WHERE messageId = ${n}
    RETURNING id
  `;return e.prepare(r,{pluck:!0}).get(i)??null}function no(e){let[n,r]=t.mn`
    SELECT * FROM pinnedMessages
    WHERE expiresAt IS NOT null
    ORDER BY expiresAt ASC
    LIMIT 1
  `;return e.prepare(n).get(r)??null}function ro(e,n){let[r,i]=t.mn`
    DELETE FROM pinnedMessages
    WHERE expiresAt <= ${n}
    RETURNING *
  `;return e.prepare(r).all(i)}t.cn(),t.Ii();function io(e){return{...e,isFinished:+!!e.isFinished,primaryCtaDataJson:e.primaryCtaData==null?null:JSON.stringify(e.primaryCtaData),secondaryCtaDataJson:e.secondaryCtaData==null?null:JSON.stringify(e.secondaryCtaData)}}function ao(e){return{...e,isFinished:e.isFinished===1,primaryCtaData:e.primaryCtaDataJson==null?null:JSON.parse(e.primaryCtaDataJson),secondaryCtaData:e.secondaryCtaDataJson==null?null:JSON.parse(e.secondaryCtaDataJson)}}function oo(e,n){let[r,i]=t.mn`
    SELECT EXISTS (
      SELECT 1 FROM megaphones
      WHERE id = ${n}
    )
  `;return e.prepare(r,{pluck:!0}).get(i)===1}function so(e){let[n,r]=t.mn`
    SELECT * FROM megaphones
  `;return e.prepare(n).all(r).map(e=>ao(e))}function co(e){let[n,r]=t.mn`
    SELECT id FROM megaphones
  `;return e.prepare(n,{pluck:!0}).all(r)}function lo(e,n){let r=io(n),[i,a]=t.mn`
    INSERT INTO megaphones (
      id,
      desktopMinVersion,
      priority,
      dontShowBeforeEpochMs,
      dontShowAfterEpochMs,
      showForNumberOfDays,
      primaryCtaId,
      secondaryCtaId,
      primaryCtaDataJson,
      secondaryCtaDataJson,
      conditionalId,
      title,
      body,
      primaryCtaText,
      secondaryCtaText,
      imagePath,
      localeFetched,
      shownAt,
      snoozedAt,
      snoozeCount,
      isFinished
    ) VALUES (
      ${r.id},
      ${r.desktopMinVersion},
      ${r.priority},
      ${r.dontShowBeforeEpochMs},
      ${r.dontShowAfterEpochMs},
      ${r.showForNumberOfDays},
      ${r.primaryCtaId},
      ${r.secondaryCtaId},
      ${r.primaryCtaDataJson},
      ${r.secondaryCtaDataJson},
      ${r.conditionalId},
      ${r.title},
      ${r.body},
      ${r.primaryCtaText},
      ${r.secondaryCtaText},
      ${r.imagePath},
      ${r.localeFetched},
      ${r.shownAt},
      ${r.snoozedAt},
      ${r.snoozeCount},
      ${r.isFinished}
    )
  `;e.prepare(i).run(a)}function uo(e,t){return e.transaction(()=>{lo(e,t)})()}function fo(e,n){let r=io(n),[i,a]=t.mn`
    UPDATE megaphones
    SET
      desktopMinVersion = ${r.desktopMinVersion},
      priority = ${r.priority},
      dontShowBeforeEpochMs = ${r.dontShowBeforeEpochMs},
      dontShowAfterEpochMs = ${r.dontShowAfterEpochMs},
      showForNumberOfDays = ${r.showForNumberOfDays},
      primaryCtaId = ${r.primaryCtaId},
      secondaryCtaId = ${r.secondaryCtaId},
      primaryCtaDataJson = ${r.primaryCtaDataJson},
      secondaryCtaDataJson = ${r.secondaryCtaDataJson},
      conditionalId = ${r.conditionalId},
      title = ${r.title},
      body = ${r.body},
      primaryCtaText = ${r.primaryCtaText},
      secondaryCtaText = ${r.secondaryCtaText},
      imagePath = ${r.imagePath},
      localeFetched = ${r.localeFetched},
      shownAt = ${r.shownAt},
      snoozedAt = ${r.snoozedAt},
      snoozeCount = ${r.snoozeCount},
      isFinished = ${r.isFinished}
    WHERE
      id = ${r.id}
  `;e.prepare(i).run(a)}function po(e,n){let[r,i]=t.mn`
    UPDATE megaphones
    SET isFinished = 1
    WHERE id = ${n}
  `,a=e.prepare(r).run(i);t.Ri(a.changes===1,`finishMegaphone: Expected changes: 1, Actual: ${a.changes}`)}function mo(e,n){let[r,i]=t.mn`
    UPDATE megaphones
    SET
      snoozedAt = ${Date.now()},
      snoozeCount = snoozeCount + 1
    WHERE id = ${n}
  `,a=e.prepare(r).run(i);t.Ri(a.changes===1,`snoozeMegaphone: Expected changes: 1, Actual: ${a.changes}`)}function ho(e,n){let[r,i]=t.mn`
    DELETE FROM megaphones
    WHERE id = ${n}
  `,a=e.prepare(r).run(i);t.Ri(a.changes===1,`deleteMegaphone: Expected changes: 1, Actual: ${a.changes}`)}function go(e){let[n,r]=t.mn`
    DELETE FROM megaphones
  `;return e.prepare(n).run(r).changes}function _o(e){let t=e.prepare(`SELECT imagePath FROM megaphones WHERE imagePath IS NOT NULL`,{pluck:!0}).all();return new Set(t)}t.cn();function vo(e){let[n,r]=t.mn`
    SELECT aci
    FROM key_transparency_account_data
  `;return e.prepare(n,{pluck:!0}).all(r)}function yo(e,n){let[r,i]=t.mn`
    SELECT data
    FROM key_transparency_account_data
    WHERE aci IS ${n}
  `;return e.prepare(r,{pluck:!0}).get(i)}function bo(e,n,r){let[i,a]=t.mn`
    INSERT OR REPLACE INTO key_transparency_account_data
      (aci, data)
    VALUES
      (${n}, ${r});
  `;e.prepare(i).run(a)}function xo(e){e.exec(`
    DELETE FROM key_transparency_account_data;
  `)}i.On(),i.I(),i.O(),t.Ii();const So=new class e{#e;constructor(e){this.#e=e}fatal(...e){this.#t(`fatal`,e)}error(...e){this.#t(`error`,e)}warn(...e){this.#t(`warn`,e)}info(...e){this.#t(`info`,e)}debug(...e){this.#t(`debug`,e)}trace(...e){this.#t(`trace`,e)}child(t){return new e(`${this.#e}[${t}] `)}#t(e,n){if(u.parentPort){let[t,...r]=n,i={type:`log`,level:e,args:[this.#e+t].concat(r)};u.parentPort.postMessage(i)}else t.Ri(!1,`must be test environment`),h[e](this.#e+(0,l.format)(...n))}}(``);t.Na(),t.d(),t.Bt(),t.Qi();const P=t.to().optional().transform(t.l).catch(null),F=t.Za().optional().transform(t.l).catch(null),Co=t.no([t.Ja(1),t.Ja(2)]).optional().transform(t.l).catch(null),I=t.no([t.Ja(0),t.Ja(1)]).optional().transform(t.l).catch(null),wo=t.Qa({messageId:t.to(),messageType:t.to(),editHistoryIndex:t.Za(),attachmentType:t.Vt,orderInMessage:t.Za(),conversationId:t.to(),sentAt:t.Za().catch(0),receivedAt:t.Za().catch(0),size:t.Za().catch(0),contentType:t.to().catch(t.zi),receivedAtMs:F,duration:F,path:P,clientUuid:P,localKey:P,plaintextHash:P,caption:P,blurHash:P,height:F,width:F,digest:P,key:P,fileName:P,downloadPath:P,transitCdnKey:P,transitCdnNumber:F,transitCdnUploadTimestamp:F,backupCdnNumber:F,incrementalMac:P,incrementalMacChunkSize:F,thumbnailPath:P,thumbnailSize:F,thumbnailContentType:P,thumbnailLocalKey:P,thumbnailVersion:Co,screenshotPath:P,screenshotSize:F,screenshotContentType:P,screenshotLocalKey:P,screenshotVersion:Co,backupThumbnailPath:P,backupThumbnailSize:F,backupThumbnailContentType:P,backupThumbnailLocalKey:P,backupThumbnailVersion:Co,storyTextAttachmentJson:P,localBackupPath:P,flags:F,error:I,wasTooBig:I,backfillError:I,isCorrupted:I,isViewOnce:I,copiedFromQuotedAttachment:I,version:Co,pending:I});t.n(),i.l(),t.Oa(),t.cn();let L;(function(e){let n=null,r=0,i=!1,a=!1,o=null;function s(e){n=e}e.setOnCheckpointNeeded=s;function c(){n=null,o!=null&&(clearTimeout(o),o=null),r=0,i=!1,a=!1}e._reset=c;function l(e,n,r,i,a){try{e.pragma(`wal_checkpoint(TRUNCATE)`),a()}catch(o){if(o.code!==`SQLITE_LOCKED`){n.error(`WalCheckpoints.run: Unexpected error (attempts: ${r}, reason: ${i})`,t.Aa(o));return}n.warn(`WalCheckpoints.run: Database is locked, retrying (attempts: ${r}, reason: ${i})`,t.Aa(o)),setTimeout(()=>{l(e,n,r+1,i,a)},1e3)}}function u(e,t,n){o!=null&&(clearTimeout(o),o=null),l(e,t,0,n,()=>{r=Date.now(),i=!1,a=!1})}e.runImmediately=u;function d(e,t){if(n==null){e.error(`WalCheckpoints.runWhenIdle: setOnCheckpointNeeded has not been called`);return}i||(i=!0,n(t))}function f(e,t){if(i)return;let n=a,s=e===`delete`;e===`delete`&&(a=!0);let c=Date.now()-r,l=a?5e3:3e4;if(c>=l){o!=null&&(clearTimeout(o),o=null),d(t,e);return}if(o!=null){if(n||!s)return;clearTimeout(o)}o=setTimeout(()=>{o=null,d(t,e)},l-c)}e._scheduleRun=f;function p(e,t){e.setWalHook((e,n)=>{n>=1e3?d(t,`page-threshold`):f(`commit`,t)})}e.setupCommitHook=p;function m(e){let[n,r]=t.mn`
      SELECT name FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        AND name NOT LIKE 'messages_fts_%'
        AND sql NOT LIKE 'CREATE VIRTUAL TABLE%'
    `;return e.prepare(n,{pluck:!0}).all(r)}function h(e,t){e.createFunction(`_wal_checkpoint_on_delete`,()=>{f(`delete`,t)});let n=m(e);for(let t of n)e.exec(`
        CREATE TEMP TRIGGER IF NOT EXISTS _wal_checkpoint_${t}_after_delete
        AFTER DELETE ON "${t}"
        BEGIN
          SELECT _wal_checkpoint_on_delete();
        END;
      `)}e.setupDeleteTriggers=h})(L||={}),t.Na(),i.rt(),i.zr(),t.Oa(),t.Ii(),n.f(),t.d(),t.ga(),t.cn(),t.s(),i.T(),t.Bt(),i.Ot(),t.sa(),t.Jt(),i.o();const{fromPairs:To,groupBy:Eo,isBoolean:Do,isNil:Oo,isNumber:R,isString:ko,last:Ao,map:jo,mapValues:Mo,noop:No,omit:z,partition:Po,pick:Fo}=m.default,Io=[`messageId`,`attachmentType`,`attachmentSignature`,`receivedAt`,`sentAt`,`contentType`,`size`,`active`,`attempts`,`retryAfter`,`lastAttemptTimestamp`,`attachmentJson`,`ciphertextSize`,`originalSource`,`source`],Lo={close:Yo,getIdentityKeyById:ts,getAllIdentityKeys:as,getKyberPreKeyById:ss,getAllKyberPreKeys:ps,getPreKeyById:hs,getAllPreKeys:bs,getSignedPreKeyById:Ss,getAllSignedPreKeys:Ds,getItemById:As,getAllItems:js,getSenderKeyById:Fs,getAllSenderKeys:Ls,getAllSentProtos:Ks,_getAllSentProtoRecipients:qs,_getAllSentProtoMessageIds:Js,getAllSessions:rc,getAllKyberTriples:ic,getConversationCount:ac,getConversationById:pc,getAllConversations:mc,getAllConversationIds:hc,getGroupSendCombinedEndorsementExpiration:Ca,getGroupSendEndorsementsData:wa,getGroupSendMemberEndorsement:Ta,searchMessages:gc,getMessageCount:vc,getStoryCount:_c,getRecentStoryReplies:cl,countStoryReadsByConversation:Gd,getReactionByTimestamp:rl,_getAllReactions:ol,getMessageByAuthorAciAndSentAt:Xc,getMessageById:Gc,getMessagesById:Kc,_getAllMessages:qc,_getAllEditedMessages:kf,getAllMessageIds:Yc,getMessagesBySentAt:hu,getExpiredMessages:gu,getMessagesUnexpectedlyMissingExpirationStartTimestamp:_u,getSoonestMessageExpiry:vu,getNextTapToViewMessageTimestampToAgeOut:yu,getTapToViewMessagesNeedingErase:bu,getOlderMessagesByConversation:ul,getAllStories:dl,getNewerMessagesByConversation:fl,getOldestUnreadMentionOfMeForConversation:Sl,getTotalUnreadForConversation:Cl,getTotalUnreadMentionsOfMeForConversation:wl,getMessageMetricsForConversation:El,getConversationRangeCenteredOnMessage:Dl,getConversationMessageStats:yl,getLastConversationMessage:bl,getAllCallHistory:Ol,getCallHistoryUnreadCallConversationIds:Ul,getCallHistoryUnreadCount:Wl,getCallHistoryMessageByCallId:Nl,getCallHistory:Pl,getCallHistoryGroupsCount:$l,getCallHistoryGroups:nu,hasGroupCallHistoryMessage:iu,getPrevUnreadCallIdInConversation:au,hasMedia:ou,getSortedMedia:cu,getSortedNonAttachmentMedia:lu,getSortedDocuments:uu,getAllNotificationProfiles:Jd,getNotificationProfileById:Yd,getAllDonationReceipts:pa,getDonationReceiptById:ma,getAllChatFolders:Oa,getCurrentChatFolders:ka,getChatFolder:Aa,hasAllChatsChatFolder:Na,getOldestDeletedChatFolder:Ua,getAllMegaphones:so,getAllMegaphoneIds:co,hasMegaphone:oo,getAllKTAcis:vo,getKTAccountData:yo,getAllPinnedMessages:Ja,getPinnedMessagesPreloadDataForConversation:Ya,getNextExpiringPinnedMessageAcrossConversations:no,callLinkExists:zi,getAllCallLinks:Hi,getCallLinkByRoomId:Bi,getCallLinkRecordByRoomId:Vi,getDefunctCallLinkByRoomId:ia,getAllAdminCallLinks:ta,getAllCallLinkRecordsForStorageService:ea,getAllDefunctCallLinksForStorageService:ra,getTimestampOfOldestDefunctCallLink:sa,getTimestampOfOldestDeletedCallLink:ua,getMessagesBetween:hl,getNearbyMessageFromDeletedSet:gl,getMostRecentAddressableMessages:bc,getMostRecentAddressableNondisappearingMessages:xc,getUnprocessedCount:Su,_getAttachmentDownloadJob:Ou,getStickerCount:od,getAllStickerPacks:sd,getInstalledStickerPacks:fd,getUninstalledStickerPacks:dd,getStickerPackInfo:pd,getAllStickers:gd,getRecentStickers:_d,getRecentEmojis:yd,getRecentGifs:xd,getAllBadges:wd,getAllBadgeImageFileLocalPaths:Dd,getAllMegaphoneImageLocalPaths:_o,getAllStoryDistributionsWithMembers:Fd,getStoryDistributionWithMembers:Id,_getAllStoryDistributions:jd,_getAllStoryDistributionMembers:Md,_getAllStoryReads:Vd,getLastStoryReadsForAuthor:Wd,getMessagesNeedingUpgrade:af,getMessageServerGuidsForSpam:sf,getJobsInQueue:_f,wasGroupCallRingPreviouslyCanceled:yf,getMaxMessageCounter:Cf,getStatisticsForLogging:wf,getMostRecentAttachmentUploadData:Lc,getBackupCdnObjectMetadata:Ku,getBackupAttachmentDownloadProgress:ju,getAttachmentReferencesForMessages:Mi,getMessageCountBySchemaVersion:jf,getMessageSampleForSchemaVersion:Mf,isAttachmentSafeToDelete:Ic,getAllProtectedAttachmentPaths:Fc,getKnownMessageAttachments:cf,finishGetKnownMessageAttachments:lf,pageMessages:uf,finishPageMessages:df,pageBackupMessages:ff,getKnownDownloads:pf,getKnownConversationAttachments:mf,__dangerouslyRunAbitraryReadOnlySqlQuery:Vf},Ro={close:Xo,removeIndexedDBFiles:Qo,createOrUpdateIdentityKey:es,bulkAddIdentityKeys:ns,removeIdentityKeyById:rs,removeAllIdentityKeys:is,createOrUpdateKyberPreKey:os,bulkAddKyberPreKeys:cs,removeKyberPreKeyById:ls,removeKyberPreKeysByServiceId:us,removeAllKyberPreKeys:fs,createOrUpdatePreKey:ms,bulkAddPreKeys:gs,removePreKeyById:_s,removePreKeysByServiceId:vs,removeAllPreKeys:ys,createOrUpdateSignedPreKey:xs,bulkAddSignedPreKeys:Cs,removeSignedPreKeyById:ws,removeSignedPreKeysByServiceId:Ts,removeAllSignedPreKeys:Es,createOrUpdateItem:ks,removeItemById:Ms,removeAllItems:Ns,createOrUpdateSenderKey:Ps,removeAllSenderKeys:Is,removeSenderKeyById:Rs,insertSentProto:zs,deleteSentProtosOlderThan:Bs,deleteSentProtoByMessageId:Vs,insertProtoRecipients:Hs,deleteSentProtoRecipient:Us,removeAllSentProtos:Gs,getSentProtoByRecipient:Ws,createOrUpdateSession:Xs,createOrUpdateSessions:Zs,commitDecryptResult:Qs,removeSessionById:$s,removeSessionsByConversation:ec,removeSessionsByServiceId:tc,removeAllSessions:nc,saveConversation:sc,saveConversations:cc,updateConversation:lc,updateConversations:uc,_removeConversation:dc,_removeAllConversations:fc,updateAllConversationColors:Tf,removeAllProfileKeyCredentials:Ef,getUnreadByConversationAndMarkRead:Qc,getUnreadEditedMessagesAndMarkRead:Af,getUnreadReactionsAndMarkRead:$c,getUnreadPollVotesAndMarkRead:tl,replaceAllEndorsementsForGroup:va,deleteAllEndorsementsForGroup:Sa,saveMessage:zc,saveMessages:Bc,saveMessagesIndividually:Vc,removeMessage:Hc,removeMessages:Wc,markReactionAsRead:el,markPollVoteAsRead:nl,addReaction:il,removeReactionFromConversation:al,_removeAllReactions:sl,_removeAllMessages:Jc,_removeMessage:Hc,clearCallHistory:Al,_removeAllCallHistory:kl,markCallHistoryDeleted:jl,cleanupCallHistoryMessages:Ml,getUnreadCallMessageAndMarkRead:Jl,getUnreadCallMessagesAndMarkRead:Yl,getUnreadCallMessagesInConversationAndMarkRead:Xl,saveCallHistory:ru,markCallHistoryMissed:fu,insertCallLink:Wi,insertOrUpdateCallLinkFromSync:Gi,updateCallLink:Ki,updateCallLinkState:qi,markAllCallLinksDeleted:$i,markCallLinkDeleted:Zi,deleteCallLink:da,deleteDefunctCallLink:ca,deleteCallHistoryByRoomId:Xi,deleteCallLinkAndHistory:Qi,_removeAllCallLinks:na,insertDefunctCallLink:aa,updateDefunctCallLink:oa,deleteExpiredCallLinks:fa,deleteExpiredDefunctCallLinks:la,migrateConversationMessages:mu,saveEditedMessage:Of,saveEditedMessages:Df,incrementMessagesMigrationAttempts:of,removeSyncTaskById:Sc,removeSyncTasks:wc,saveSyncTasks:Tc,incrementAllSyncTaskAttempts:Dc,dequeueOldestSyncTasks:Oc,getUnprocessedByIdsAndIncrementAttempts:wu,getAllUnprocessedIds:Cu,removeUnprocessed:Eu,removeAllUnprocessed:Du,getNextAttachmentDownloadJobs:Mu,saveAttachmentDownloadJob:Pu,saveAttachmentDownloadJobs:Nu,resetAttachmentDownloadActive:Fu,resetBackupAttachmentDownloadJobsRetryAfter:Iu,removeAttachmentDownloadJob:Lu,removeAttachmentDownloadJobsForMessage:Ru,removeAllBackupAttachmentDownloadJobs:ku,resetBackupAttachmentDownloadStats:Au,getAndProtectExistingAttachmentPath:jc,_protectAttachmentPathFromDeletion:Mc,resetProtectedAttachmentPaths:Pc,getNextAttachmentBackupJobs:Hu,saveAttachmentBackupJob:Vu,markAllAttachmentBackupJobsInactive:Bu,removeAttachmentBackupJob:Uu,clearAllAttachmentBackupJobs:zu,clearAllBackupCdnObjectMetadata:Wu,saveBackupCdnObjectMetadata:Gu,createOrUpdateStickerPack:qu,createOrUpdateStickerPacks:Ju,updateStickerPackStatusAndPosition:Yu,updateStickerPackInfo:Xu,updateStickerPacksPositions:Zu,createOrUpdateSticker:$u,createOrUpdateStickers:ed,updateStickerLastUsed:td,addStickerPackReference:nd,deleteStickerPackReference:rd,deleteStickerPack:ad,getUnresolvedStickerPackReferences:id,addUninstalledStickerPack:cd,addUninstalledStickerPacks:ld,installStickerPack:md,uninstallStickerPack:hd,removeUninstalledStickerPack:ud,clearAllErrorStickerPackAttempts:Qu,updateEmojiUsage:vd,addRecentGif:Sd,removeRecentGif:Cd,updateOrCreateBadges:Td,badgeImageFileDownloaded:Ed,getRecentStaleRingsAndMarkOlderMissed:pu,_deleteAllStoryDistributions:Nd,createNewStoryDistribution:Pd,modifyStoryDistribution:Ld,modifyStoryDistributionMembers:Rd,modifyStoryDistributionWithMembers:zd,deleteStoryDistribution:Bd,_deleteAllStoryReads:Hd,addNewStoryRead:Ud,_deleteAllNotificationProfiles:Xd,createNotificationProfile:$d,deleteNotificationProfileById:Zd,markNotificationProfileDeleted:Qd,updateNotificationProfile:ef,_deleteAllDonationReceipts:ha,deleteDonationReceiptById:ga,createDonationReceipt:_a,createChatFolder:Ma,createAllChatsChatFolder:Pa,upsertAllChatsChatFolderFromSync:Fa,updateChatFolder:Ia,updateChatFolderToggleChat:La,updateChatFolderPositions:Va,updateChatFolderDeletedAtTimestampMsFromSync:Ha,markChatFolderDeleted:za,deleteExpiredChatFolders:Wa,deleteChatFolderById:Ga,createMegaphone:uo,updateMegaphone:fo,deleteMegaphone:ho,finishMegaphone:po,snoozeMegaphone:mo,internalDeleteAllMegaphones:go,setKTAccountData:bo,removeAllKTAccountData:xo,appendPinnedMessage:eo,deletePinnedMessageByMessageId:to,deleteAllExpiredPinnedMessagesBefore:ro,removeAll:tf,removeAllConfiguration:nf,eraseStorageServiceState:rf,insertJob:X,deleteJob:vf,processGroupCallRingCancellation:bf,cleanExpiredGroupCallRingCancellations:Sf,disableMessageInsertTriggers:Nf,enableMessageInsertTriggersAndBackfill:Lf,ensureMessageInsertTriggersAreEnabled:Bf,disableFSync:Ff,enableFSyncAndCheckpoint:If,_testOnlyRemoveMessageAttachments:Rc,removeKnownStickers:hf,removeKnownDraftAttachments:gf,runCorruptionChecks:Od};function zo(e){let{expireTimerVersion:n}=e,r=JSON.parse(e.json),a;return i.sr(e.profileLastFetchedAt)?a=e.profileLastFetchedAt:(t.Fi(Oo(e.profileLastFetchedAt),`profileLastFetchedAt contained invalid data; defaulting to undefined`),a=void 0),{...r,expireTimerVersion:n,profileLastFetchedAt:a}}function Bo(e){return{...e,isCoverOnly:!!e.isCoverOnly,emoji:e.emoji==null?void 0:t.t.unsafeCastMaybeInvalidStringToVariant(e.emoji),version:e.version||1,localKey:t.u(e.localKey),size:t.u(e.size)}}function Vo(e,t){e.pragma(`key = "x'${t}'"`)}function Ho(e){e.pragma(`journal_mode = WAL`),e.pragma(`synchronous = FULL`),L.setupCommitHook(e,B)}function Uo(e){if(t.sn(e)>0)return;let n=t.on(e),r=n>18?16:n;B.info(`migrateSchemaVersion: Migrating from schema_version ${n} to user_version ${r}`),t.pn(e,r)}function Wo(e,t){let n;try{return n=new p.default(e,{cacheStatements:!0}),Vo(n,t),Ho(n),Uo(n),n}catch{n&&n.close(),B.info(`migrateDatabase: Migration without cipher change failed`)}n=new p.default(e);try{Vo(n,t),n.pragma(`cipher_compatibility = 3`),Uo(n),n.close(),n=new p.default(e),Vo(n,t),n.pragma(`cipher_migrate`),Ho(n)}catch(e){try{n.close()}catch{}throw e}return n}const Go=/[^0-9A-Fa-f]/;function Ko(e,{key:n}){if(Go.exec(n))throw Error(`setupSQLCipher: key '${n}' is not valid`);let r=Wo(e,n);try{r.pragma(`foreign_keys = ON`)}catch(e){try{r.close()}catch{}throw e}try{r.pragma(`fullfsync = false`),r.pragma(`checkpoint_fullfsync = true`)}catch(e){B.warn(`openAndSetUpSQLCipher: Unable to set fullfsync`,t.Aa(e))}return r.initTokenizer(),r}let B=So,V,qo;(0,p.setLogger)((e,t)=>{if(e!==`SQLITE_SCHEMA`){if(e===`SQLITE_NOTICE`){B.info(`sqlite(${e}): ${t}`);return}B.warn(`sqlite(${e}): ${t}`)}});function Jo({configDir:e,key:t,isPrimary:n}){if(!ko(e))throw Error(`initialize: configDir is required!`);if(!ko(t))throw Error(`initialize: key is required!`);qo=(0,a.join)(e,`IndexedDB`);let r=(0,a.join)(e,`sql`);(0,s.mkdirSync)(r,{recursive:!0}),V=(0,a.join)(r,`db.sqlite`);let i;try{return i=Ko(V,{key:t}),n&&(Di(i,B,{userDataPath:e}),L.setupDeleteTriggers(i,B)),vc(i),i}catch(e){throw B.error(`Database startup error:`,e.stack),i?.close(),e}}function Yo(e){e.close()}function Xo(e){L.runImmediately(e,B,`close`),e.pragma(`optimize`),e.close()}function Zo(){if(!V)throw Error(`removeDB: Cannot erase database without a databaseFilePath!`);B.warn(`removeDB: Removing all database files`),(0,s.rmSync)(V,{recursive:!0,force:!0}),(0,s.rmSync)(`${V}-shm`,{recursive:!0,force:!0}),(0,s.rmSync)(`${V}-wal`,{recursive:!0,force:!0})}function Qo(e){if(!qo)throw Error(`removeIndexedDBFiles: Need to initialize and set indexedDBPath first!`);(0,s.rmSync)((0,a.join)(qo,`*.leveldb`),{recursive:!0,force:!0}),qo=void 0}function $o(e,t){return e}const H=`identityKeys`;function es(e,n){return t.en(e,H,n)}function ts(e,n){return t.nn(e,H,n)}function ns(e,n){return t.Zt(e,H,n)}function rs(e,n){return t.fn(e,H,n)}function is(e){return t.dn(e,H)}function as(e){return t.tn(e,H)}const U=`kyberPreKeys`;function os(e,n){return t.en(e,U,n)}function ss(e,n){return t.nn(e,U,n)}function cs(e,n){return t.Zt(e,U,n)}function ls(e,n){return t.fn(e,U,n)}function us(e,t){e.prepare(`DELETE FROM kyberPreKeys WHERE ourServiceId IS $serviceId;`).run({serviceId:t})}function ds(e,{id:n,signedPreKeyId:r,baseKey:i}){let[a,o]=t.mn`
    INSERT OR FAIL INTO kyberPreKey_triples
      (id, signedPreKeyId, baseKey)
    VALUES
      (${n}, ${r}, ${i});
  `;try{e.prepare(a).run(o)}catch(e){throw e.code===`SQLITE_CONSTRAINT_UNIQUE`?Error(`Duplicate kyber triple ${n}:${r}`):e}}function fs(e){return t.dn(e,U)}function ps(e){return t.tn(e,U)}const W=`preKeys`;function ms(e,n){return t.en(e,W,n)}function hs(e,n){return t.nn(e,W,n)}function gs(e,n){return t.Zt(e,W,n)}function _s(e,n){return t.fn(e,W,n)}function vs(e,t){e.prepare(`DELETE FROM preKeys WHERE ourServiceId IS $serviceId;`).run({serviceId:t})}function ys(e){return t.dn(e,W)}function bs(e){return t.tn(e,W)}const G=`signedPreKeys`;function xs(e,n){return t.en(e,G,n)}function Ss(e,n){return t.nn(e,G,n)}function Cs(e,n){return t.Zt(e,G,n)}function ws(e,n){return t.fn(e,G,n)}function Ts(e,t){e.prepare(`DELETE FROM signedPreKeys WHERE ourServiceId IS $serviceId;`).run({serviceId:t})}function Es(e){return t.dn(e,G)}function Ds(e){return e.prepare(`
      SELECT json
      FROM signedPreKeys
      ORDER BY id ASC;
      `).all().map(e=>t.ln(e.json))}const Os=`items`;function ks(e,n){return t.en(e,Os,n)}function As(e,n){return t.nn(e,Os,n)}function js(e){let n=e.prepare(`SELECT json FROM items ORDER BY id ASC;`).all().map(e=>t.ln(e.json)),r=Object.create(null);for(let{id:e,value:t}of n)r[e]=t;return r}function Ms(e,n){return t.fn(e,Os,n)}function Ns(e){return t.dn(e,Os)}function Ps(e,t){e.prepare(`
    INSERT OR REPLACE INTO senderKeys (
      id,
      senderId,
      distributionId,
      data,
      lastUpdatedDate
    ) values (
      $id,
      $senderId,
      $distributionId,
      $data,
      $lastUpdatedDate
    )
    `).run(t)}function Fs(e,t){return e.prepare(`SELECT * FROM senderKeys WHERE id = $id`).get({id:t})}function Is(e){e.prepare(`DELETE FROM senderKeys`).run()}function Ls(e){return e.prepare(`SELECT * FROM senderKeys`).all()}function Rs(e,t){e.prepare(`DELETE FROM senderKeys WHERE id = $id`).run({id:t})}function zs(e,n,r){let{recipients:a,messageIds:o}=r;return e.transaction(()=>{let r=t.h(e.prepare(`
      INSERT INTO sendLogPayloads (
        contentHint,
        proto,
        timestamp,
        urgent,
        hasPniSignatureMessage
      ) VALUES (
        $contentHint,
        $proto,
        $timestamp,
        $urgent,
        $hasPniSignatureMessage
      );
      `).run({...n,urgent:+!!n.urgent,hasPniSignatureMessage:+!!n.hasPniSignatureMessage}).lastInsertRowid,`insertSentProto/lastInsertRowid`),s=e.prepare(`
      INSERT INTO sendLogRecipients (
        payloadId,
        recipientServiceId,
        deviceId
      ) VALUES (
        $id,
        $recipientServiceId,
        $deviceId
      );
      `);for(let[e,n]of Object.entries(a)){t.Ri(i.Vr(e),`Recipient must be a service id`);for(let t of n)s.run({id:r,recipientServiceId:e,deviceId:t})}let c=e.prepare(`
      INSERT INTO sendLogMessageIds (
        payloadId,
        messageId
      ) VALUES (
        $id,
        $messageId
      );
      `);for(let e of new Set(o))c.run({id:r,messageId:e});return r})()}function Bs(e,t){e.prepare(`
    DELETE FROM sendLogPayloads
    WHERE
      timestamp IS NULL OR
      timestamp < $timestamp;
    `).run({timestamp:t})}function Vs(e,t){e.prepare(`
    DELETE FROM sendLogPayloads WHERE id IN (
      SELECT payloadId FROM sendLogMessageIds
      WHERE messageId = $messageId
    );
    `).run({messageId:t})}function Hs(e,{id:t,recipientServiceId:n,deviceIds:r}){e.transaction(()=>{let i=e.prepare(`
      INSERT INTO sendLogRecipients (
        payloadId,
        recipientServiceId,
        deviceId
      ) VALUES (
        $id,
        $recipientServiceId,
        $deviceId
      );
      `);for(let e of r)i.run({id:t,recipientServiceId:n,deviceId:e})})()}function Us(e,n){let r=Array.isArray(n)?n:[n];return e.transaction(()=>{let n=[];for(let i of r){let{timestamp:r,recipientServiceId:a,deviceId:o}=i,[s,...c]=e.prepare(`
        SELECT sendLogPayloads.id, sendLogPayloads.hasPniSignatureMessage
        FROM sendLogPayloads
        INNER JOIN sendLogRecipients
          ON sendLogRecipients.payloadId = sendLogPayloads.id
        WHERE
          sendLogPayloads.timestamp = $timestamp AND
          sendLogRecipients.recipientServiceId = $recipientServiceId AND
          sendLogRecipients.deviceId = $deviceId;
       `).all({timestamp:r,recipientServiceId:a,deviceId:o});if(s==null)continue;c.length>0&&B.warn(`deleteSentProtoRecipient: More than one payload matches recipient and timestamp ${r}. Using the first.`);let{id:l,hasPniSignatureMessage:u}=s;e.prepare(`
        DELETE FROM sendLogRecipients
        WHERE
          payloadId = $id AND
          recipientServiceId = $recipientServiceId AND
          deviceId = $deviceId;
        `).run({id:l,recipientServiceId:a,deviceId:o});let d=e.prepare(`
        SELECT count(1) FROM sendLogRecipients
        WHERE payloadId = $id AND recipientServiceId = $recipientServiceId;
        `,{pluck:!0}).get({id:l,recipientServiceId:a})??0;d===0&&u&&(B.info(`deleteSentProtoRecipient: Successfully shared phone number with ${a} through message ${r}`),n.push(a)),t.Ri(R(d),`deleteSentProtoRecipient: select count() returned non-number!`);let f=e.prepare(`SELECT count(1) FROM sendLogRecipients WHERE payloadId = $id;`,{pluck:!0}).get({id:l});t.Ri(R(f),`deleteSentProtoRecipient: select count() returned non-number!`),!(f>0)&&(B.info(`deleteSentProtoRecipient: Deleting proto payload for timestamp ${r}`),e.prepare(`DELETE FROM sendLogPayloads WHERE id = $id;`).run({id:l}))}return{successfulPhoneNumberShares:n}})()}function Ws(e,{now:t,recipientServiceId:n,timestamp:r}){Bs(e,t-1e3*60*60*24);let i=e.prepare(`
    SELECT
      sendLogPayloads.*,
      GROUP_CONCAT(DISTINCT sendLogMessageIds.messageId) AS messageIds
    FROM sendLogPayloads
    INNER JOIN sendLogRecipients ON sendLogRecipients.payloadId = sendLogPayloads.id
    LEFT JOIN sendLogMessageIds ON sendLogMessageIds.payloadId = sendLogPayloads.id
    WHERE
      sendLogPayloads.timestamp = $timestamp AND
      sendLogRecipients.recipientServiceId = $recipientServiceId
    GROUP BY sendLogPayloads.id;
    `).get({timestamp:r,recipientServiceId:n});if(!i)return;let{messageIds:a}=i;return{...i,urgent:R(i.urgent)?!!i.urgent:!0,hasPniSignatureMessage:R(i.hasPniSignatureMessage)?!!i.hasPniSignatureMessage:!0,messageIds:a?a.split(`,`):[]}}function Gs(e){e.prepare(`DELETE FROM sendLogPayloads;`).run()}function Ks(e){return e.prepare(`SELECT * FROM sendLogPayloads;`).all().map(e=>({...e,urgent:R(e.urgent)?!!e.urgent:!0,hasPniSignatureMessage:R(e.hasPniSignatureMessage)?!!e.hasPniSignatureMessage:!0}))}function qs(e){return e.prepare(`SELECT * FROM sendLogRecipients;`).all()}function Js(e){return e.prepare(`SELECT * FROM sendLogMessageIds;`).all()}const Ys=`sessions`;function Xs(e,t){let{id:n,conversationId:r,ourServiceId:i,serviceId:a,deviceId:o,record:s}=t;if(!n)throw Error(`createOrUpdateSession: Provided data did not have a truthy id`);if(!r)throw Error(`createOrUpdateSession: Provided data did not have a truthy conversationId`);e.prepare(`
    INSERT OR REPLACE INTO sessions (
      id,
      conversationId,
      ourServiceId,
      serviceId,
      deviceId,
      record
    ) values (
      $id,
      $conversationId,
      $ourServiceId,
      $serviceId,
      $deviceId,
      $record
    )
    `).run({id:n,conversationId:r,ourServiceId:i,serviceId:a,deviceId:o,record:s})}function Zs(e,t){e.transaction(()=>{for(let n of t)Xs(e,n)})()}function Qs(e,{kyberPreKeysToRemove:t,preKeysToRemove:n,senderKeys:r,sessions:i,unprocessed:a,kyberTriples:o}){e.transaction(()=>{if(t.length>0){let n=ls(e,t);n===t.length?B.info(`commitDecryptResult: Removed ${n} kyberPreKeys`):B.error(`commitDecryptResult: Changed ${n} keys, but had ${t.length} kyberPreKeys to remove`)}if(n.length>0){let t=_s(e,n);t===n.length?B.info(`commitDecryptResult: Removed ${t} preKeys`):B.error(`commitDecryptResult: Changed ${t} keys, but had ${n.length} preKeys to remove`)}for(let t of r)Ps(e,t);for(let t of i)Xs(e,t);for(let t of a)xu(e,t);for(let t of o)ds(e,t)})()}function $s(e,n){return t.fn(e,Ys,n)}function ec(e,t){e.prepare(`
    DELETE FROM sessions
    WHERE conversationId = $conversationId;
    `).run({conversationId:t})}function tc(e,t){e.prepare(`
    DELETE FROM sessions
    WHERE serviceId = $serviceId;
    `).run({serviceId:t})}function nc(e){return t.dn(e,Ys)}function rc(e){return e.prepare(`SELECT * FROM sessions`).all()}function ic(e){return e.prepare(`SELECT * FROM kyberPreKey_triples`).all()}function ac(e){return t.rn(e,`conversations`)}function oc({members:e,membersV2:t}){return t?t.map(e=>e.aci).join(` `):e?e.join(` `):null}function sc(e,n){let{active_at:r,e164:a,groupId:o,id:s,name:c,profileFamilyName:l,profileName:u,profileLastFetchedAt:d,type:f,serviceId:p,expireTimerVersion:m}=n,h=oc(n);e.prepare(`
    INSERT INTO conversations (
      id,
      json,

      e164,
      serviceId,
      groupId,

      active_at,
      type,
      members,
      name,
      profileName,
      profileFamilyName,
      profileFullName,
      profileLastFetchedAt,
      expireTimerVersion
    ) values (
      $id,
      $json,

      $e164,
      $serviceId,
      $groupId,

      $active_at,
      $type,
      $members,
      $name,
      $profileName,
      $profileFamilyName,
      $profileFullName,
      $profileLastFetchedAt,
      $expireTimerVersion
    );
    `).run({id:s,json:t.un(z(n,[`profileLastFetchedAt`,`expireTimerVersion`])),e164:a||null,serviceId:p||null,groupId:o||null,active_at:r||null,type:f,members:h,name:c||null,profileName:u||null,profileFamilyName:l||null,profileFullName:i.k(u,l)||null,profileLastFetchedAt:d||null,expireTimerVersion:m})}function cc(e,t){e.transaction(()=>{for(let n of t)sc(e,n)})()}function lc(e,n){let{id:r,active_at:a,type:o,name:s,profileName:c,profileFamilyName:l,profileLastFetchedAt:u,e164:d,serviceId:f,expireTimerVersion:p}=n,m=oc(n);e.prepare(`
    UPDATE conversations SET
      json = $json,

      e164 = $e164,
      serviceId = $serviceId,

      active_at = $active_at,
      type = $type,
      members = $members,
      name = $name,
      profileName = $profileName,
      profileFamilyName = $profileFamilyName,
      profileFullName = $profileFullName,
      profileLastFetchedAt = $profileLastFetchedAt,
      expireTimerVersion = $expireTimerVersion
    WHERE id = $id;
    `).run({id:r,json:t.un(z(n,[`profileLastFetchedAt`])),e164:d||null,serviceId:f||null,active_at:a||null,type:o,members:m,name:s||null,profileName:c||null,profileFamilyName:l||null,profileFullName:i.k(c,l)||null,profileLastFetchedAt:u||null,expireTimerVersion:p})}function uc(e,t){e.transaction(()=>{for(let n of t)lc(e,n)})()}function dc(e,t){e.prepare(`DELETE FROM conversations WHERE id = $id;`).run({id:t})}function fc(e){e.prepare(`DELETE from conversations;`).run()}function pc(e,t){let n=e.prepare(`
      SELECT json, profileLastFetchedAt, expireTimerVersion
      FROM conversations
      WHERE id = $id
      `).get({id:t});if(n)return zo(n)}function mc(e){return e.prepare(`
      SELECT json, profileLastFetchedAt, expireTimerVersion
      FROM conversations
      ORDER BY id ASC;
      `).all().map(e=>zo(e))}function hc(e){return e.prepare(`
      SELECT id FROM conversations ORDER BY id ASC;
      `).all().map(e=>e.id)}function gc(e,{query:n,options:r,conversationId:a,contactServiceIdsMatchingQuery:o}){let{limit:s=a?100:500}=r??{},c=$o(e,`only temp table use`),l=c.signalTokenize(n).map(e=>`"${e.replace(/"/g,`""`)}"*`).join(` `);return l?c.transaction(()=>{c.exec(`
      CREATE TEMP TABLE tmp_results(rowid INTEGER PRIMARY KEY ASC);
      CREATE TEMP TABLE tmp_filtered_results(rowid INTEGER PRIMARY KEY ASC);
      `),c.prepare(`
        INSERT INTO tmp_results (rowid)
        SELECT
          rowid
        FROM
          messages_fts
        WHERE
          messages_fts.body MATCH $query;
      `).run({query:l}),a===void 0?c.prepare(`
          INSERT INTO tmp_filtered_results (rowid)
          SELECT
            tmp_results.rowid
          FROM
            tmp_results
          INNER JOIN
            messages ON messages.rowid = tmp_results.rowid
          ORDER BY messages.received_at DESC, messages.sent_at DESC
          LIMIT $limit;
        `).run({limit:s}):c.prepare(`
          INSERT INTO tmp_filtered_results (rowid)
          SELECT
            tmp_results.rowid
          FROM
            tmp_results
          INNER JOIN
            messages ON messages.rowid = tmp_results.rowid
          WHERE
            messages.conversationId = $conversationId
          ORDER BY messages.received_at DESC, messages.sent_at DESC
          LIMIT $limit;
        `).run({conversationId:a,limit:s});let n=t.gn`
      SELECT
        messages.rowid,
        ${t.Gt},
        snippet(messages_fts, -1, ${i.ur}, ${i.dr}, ${i.fr}, 10) AS ftsSnippet
      FROM tmp_filtered_results
      INNER JOIN messages_fts
        ON messages_fts.rowid = tmp_filtered_results.rowid
      INNER JOIN messages
        ON messages.rowid = tmp_filtered_results.rowid
      WHERE
        messages_fts.body MATCH ${l}
      ORDER BY messages.received_at DESC, messages.sent_at DESC
      LIMIT ${s}
    `,r;if(o?.length){let[e,i]=t.mn`
        SELECT
          messages.rowid as rowid,
          ${t.vn(t.Wt.map(e=>{let n=t._n(e);return t.gn`
            COALESCE(messages.${n}, ftsResults.${n}) AS ${n}
          `}))},
          ftsResults.ftsSnippet,
          mentionAci,
          start as mentionStart,
          length as mentionLength
        FROM mentions
        INNER JOIN messages
        ON
          messages.id = mentions.messageId
          AND mentions.mentionAci IN (
            ${t.vn(o)}
          )
          AND ${a?t.gn`messages.conversationId = ${a}`:`1 IS 1`}
          AND messages.isViewOnce IS NOT 1
          AND messages.storyId IS NULL
        FULL OUTER JOIN (
          ${n}
        ) as ftsResults
        USING (rowid)
        GROUP BY rowid
        ORDER BY received_at DESC, sent_at DESC
        LIMIT ${s};
        `;r=c.prepare(e).all(i)}else{let[e,i]=t.mn`${n};`;r=c.prepare(e).all(i)}c.exec(`
      DROP TABLE tmp_results;
      DROP TABLE tmp_filtered_results;
      `);let u=M(e,r);return r.map((e,n)=>{let r=u[n];return t.Ri(r,`Missing message`),{...r,ftsSnippet:e.ftsSnippet,mentionAci:e.mentionAci,mentionStart:e.mentionStart,mentionLength:e.mentionLength}})})():[]}function _c(e,t){return e.prepare(`
    SELECT count(1)
    FROM messages
    WHERE conversationId = $conversationId AND isStory = 1;
    `,{pluck:!0}).get({conversationId:t})??0}function vc(e,n){return n===void 0?t.rn(e,`messages`):e.prepare(`
    SELECT count(1)
    FROM messages
    WHERE conversationId = $conversationId;
    `,{pluck:!0}).get({conversationId:n})??0}function yc(e,t){return e.prepare(`
  SELECT EXISTS(
    SELECT 1 FROM messages
    INDEXED BY message_user_initiated
    WHERE
      conversationId IS $conversationId AND
      isUserInitiatedMessage IS 1
  );
  `,{pluck:!0}).get({conversationId:t})!==0}function bc(e,n,r=5){return e.transaction(()=>{let[i,a]=t.mn`
    SELECT ${t.Gt}
    FROM messages
    INDEXED BY messages_by_date_addressable
    WHERE
      conversationId IS ${n} AND
      isAddressableMessage = 1
    ORDER BY received_at DESC, sent_at DESC
    LIMIT ${r};
  `;return M(e,e.prepare(i).all(a))})()}function xc(e,n,r=5){return e.transaction(()=>{let[i,a]=t.mn`
    SELECT ${t.Gt}
    FROM messages
    INDEXED BY messages_by_date_addressable_nondisappearing
    WHERE
      expireTimer IS NULL AND
      conversationId IS ${n} AND
      isAddressableMessage = 1
    ORDER BY received_at DESC, sent_at DESC
    LIMIT ${r};
  `;return M(e,e.prepare(i).all(a))})()}function Sc(e,n){let[r,i]=t.mn`
    DELETE FROM syncTasks
    WHERE id IS ${n}
  `;e.prepare(r).run(i)}function Cc(e,t,n){e.prepare(`
    DELETE FROM syncTasks
    WHERE id IN ( ${t.map(()=>`?`).join(`, `)} );
    `,{persistent:n}).run(t)}function wc(e,n){t.Xt(e,n,(t,n)=>Cc(e,t,n))}function Tc(e,t){return e.transaction(()=>{t.forEach(t=>Ec(e,t))})()}function Ec(e,n){let{id:r,attempts:i,createdAt:a,data:o,envelopeId:s,sentAt:c,type:l}=n,[u,d]=t.mn`
    INSERT INTO syncTasks (
      id,
      attempts,
      createdAt,
      data,
      envelopeId,
      sentAt,
      type
    ) VALUES (
      ${r},
      ${i},
      ${a},
      ${t.un(o)},
      ${s},
      ${c},
      ${l}
    )
  `;e.prepare(u).run(d)}function Dc(e){let[n,r]=t.mn`
    UPDATE syncTasks
    SET attempts = attempts + 1
  `;return e.transaction(()=>{e.prepare(n).run(r)})()}function Oc(e,n){let{previousRowId:r,incrementAttempts:i=!0,syncTaskTypes:a}=n;return e.transaction(()=>{let n=t.gn`ORDER BY rowid ASC`,o=t.gn`LIMIT 10000`,s=t.gn`rowid > ${r??0}`;a&&a.length>0&&(s=t.gn`${s} AND type IN (${t.vn(a)})`);let[c,l]=t.mn`
      DELETE FROM syncTasks
      WHERE
        attempts >= ${5} AND
        createdAt < ${Date.now()-t.Pn*2}
    `,u=e.prepare(c).run(l);u.changes>0&&B.info(`dequeueOldestSyncTasks: Deleted ${u.changes} expired sync tasks`);let[d,f]=t.mn`
      SELECT rowid, * FROM syncTasks
      WHERE ${s}
      ${n}
      ${o}
    `,p=e.prepare(d).all(f);if(!p.length)return{tasks:[],lastRowId:null};let m=p.at(0)?.rowid,h=p.at(-1)?.rowid;t.Ri(m,`dequeueOldestSyncTasks: firstRowId is null`),t.Ri(h,`dequeueOldestSyncTasks: lastRowId is null`);let g=p.map(e=>{let{rowid:n,...r}=e;return{...r,data:t.ln(e.data)}});if(i){let n=t.gn`rowid >= ${m} AND rowid <= ${h}`;a&&a.length>0&&(n=t.gn`${n} AND type IN (${t.vn(a)})`);let[r,i]=t.mn`
        UPDATE syncTasks
        SET attempts = attempts + 1
        WHERE ${n}
        RETURNING id, attempts;
      `,o=e.prepare(r).all(i);if(Array.isArray(o)){let e=new Map(o.map(({id:e,attempts:t})=>[e,t]));g=g.map(t=>{let{id:n}=t,r=e.get(n)??t.attempts;return{...t,attempts:r}})}else B.error(`dequeueOldestSyncTasks: failed to get sync task attempts`)}return{tasks:g,lastRowId:h}})()}function kc(e,t,{editHistoryIndex:n}){let{id:r,type:i,conversationId:a,sent_at:o,received_at:s,received_at_ms:c,isViewOnce:l}=t,u=t.attachments;if(u)for(let t=0;t<u.length;t+=1){let d=u[t];K({db:e,messageId:r,messageType:i,conversationId:a,sentAt:o,receivedAt:s,receivedAtMs:c,attachmentType:`attachment`,attachment:d,orderInMessage:t,editHistoryIndex:n,isViewOnce:l})}let{bodyAttachment:d}=t;d&&K({db:e,messageId:r,messageType:i,conversationId:a,sentAt:o,receivedAt:s,receivedAtMs:c,attachmentType:`long-message`,attachment:d,orderInMessage:0,editHistoryIndex:n,isViewOnce:l});let f=t.preview?.map(e=>e.image);if(f)for(let t=0;t<f.length;t+=1){let u=f[t];u&&K({db:e,messageId:r,messageType:i,conversationId:a,sentAt:o,receivedAt:s,receivedAtMs:c,attachmentType:`preview`,attachment:u,orderInMessage:t,editHistoryIndex:n,isViewOnce:l})}let p=t.quote?.attachments;if(p)for(let t=0;t<p.length;t+=1){let u=p[t];u?.thumbnail&&K({db:e,messageId:r,messageType:i,conversationId:a,sentAt:o,receivedAt:s,receivedAtMs:c,attachmentType:`quote`,attachment:u.thumbnail,orderInMessage:t,editHistoryIndex:n,isViewOnce:l})}let m=t.contact?.map(e=>e.avatar?.avatar);if(m)for(let t=0;t<m.length;t+=1){let u=m[t];u&&K({db:e,messageId:r,messageType:i,conversationId:a,sentAt:o,receivedAt:s,receivedAtMs:c,attachmentType:`contact`,attachment:u,orderInMessage:t,editHistoryIndex:n,isViewOnce:l})}let h=t.sticker?.data;h&&K({db:e,messageId:r,messageType:i,conversationId:a,sentAt:o,receivedAt:s,receivedAtMs:c,attachmentType:`sticker`,attachment:h,orderInMessage:0,editHistoryIndex:n,isViewOnce:l})}function Ac(e,n){let[r,i]=t.mn`
    DELETE FROM message_attachments
    WHERE messageId = ${n.id};
  `;e.prepare(r).run(i),kc(e,n,{editHistoryIndex:null}),n.editHistory?.forEach((t,r)=>{kc(e,{id:n.id,type:n.type,conversationId:n.conversationId,sent_at:t.timestamp,isViewOnce:n.isViewOnce,...t},{editHistoryIndex:r})})}function K({db:e,messageId:n,messageType:r,conversationId:i,sentAt:a,receivedAt:o,receivedAtMs:s,attachmentType:c,attachment:l,orderInMessage:u,editHistoryIndex:d,isViewOnce:f}){let p={messageId:n,messageType:r,editHistoryIndex:d??-1,attachmentType:c,orderInMessage:u,conversationId:i,sentAt:a,receivedAt:o,receivedAtMs:s,clientUuid:l.clientUuid,size:l.size,duration:l.duration,contentType:l.contentType,path:l.path,localKey:l.localKey,plaintextHash:l.plaintextHash,caption:l.caption,blurHash:l.blurHash,height:l.height,width:l.width,digest:l.digest,key:l.key,fileName:l.fileName,downloadPath:l.downloadPath,transitCdnKey:l.cdnKey??l.cdnId,transitCdnNumber:l.cdnNumber,transitCdnUploadTimestamp:l.uploadTimestamp,backupCdnNumber:l.backupCdnNumber,incrementalMac:l.incrementalMac,incrementalMacChunkSize:l.chunkSize,thumbnailPath:l.thumbnail?.path,thumbnailSize:l.thumbnail?.size,thumbnailContentType:l.thumbnail?.contentType,thumbnailLocalKey:l.thumbnail?.localKey,thumbnailVersion:l.thumbnail?.version,screenshotPath:l.screenshot?.path,screenshotSize:l.screenshot?.size,screenshotContentType:l.screenshot?.contentType,screenshotLocalKey:l.screenshot?.localKey,screenshotVersion:l.screenshot?.version,backupThumbnailPath:l.thumbnailFromBackup?.path,backupThumbnailSize:l.thumbnailFromBackup?.size,backupThumbnailContentType:l.thumbnailFromBackup?.contentType,backupThumbnailLocalKey:l.thumbnailFromBackup?.localKey,backupThumbnailVersion:l.thumbnailFromBackup?.version,storyTextAttachmentJson:l.textAttachment?t.un(l.textAttachment):void 0,localBackupPath:l.localBackupPath,flags:l.flags,error:t.Qt(l.error),wasTooBig:t.Qt(l.wasTooBig),backfillError:t.Qt(l.backfillError),isCorrupted:t.Qt(l.isCorrupted),isViewOnce:t.Qt(f),copiedFromQuotedAttachment:`copied`in l?t.Qt(l.copied):void 0,version:l.version,pending:t.Qt(l.pending)};try{let n=t.f(p);e.prepare(`
        INSERT OR REPLACE INTO message_attachments
          (${t.Ut.join(`, `)})
        VALUES
          (${t.Ut.map(e=>`$${e}`).join(`, `)});
      `).run(n)}catch(n){B.error(`Failed to save to message_attachments`,t.Aa(n));let r=t.ca(wo,p);e.prepare(`
        INSERT OR REPLACE INTO message_attachments
          (${t.Ut.join(`, `)})
        VALUES
          (${t.Ut.map(e=>`$${e}`).join(`, `)});
      `).run(r),B.info(`Recovered from invalid message_attachment save`)}l.reuseToken!=null&&Nc(e,l)}function jc(e,{plaintextHash:n,version:r,contentType:i}){if(!t.fi(n)){B.error(`getAndProtectExistingAttachmentPath: Invalid plaintextHash`);return}if(r<2){B.error(`getAndProtectExistingAttachmentPath: Invalid version`,r);return}let[a,s]=t.mn`
    SELECT
      path,
      version,
      localKey,
      width,
      height,
      thumbnailPath,
      thumbnailLocalKey,
      thumbnailVersion,
      thumbnailContentType,
      thumbnailSize,
      screenshotPath,
      screenshotLocalKey,
      screenshotVersion,
      screenshotContentType,
      screenshotSize
    FROM message_attachments
    WHERE
      plaintextHash = ${n} AND
      path IS NOT NULL AND
      version = ${r} AND
      contentType = ${i}
    LIMIT 1;
  `;return e.transaction(()=>{let n=e.prepare(a).get(s);if(!n)return;let r=(0,o.randomBytes)(16).toString(`hex`),[i,c]=t.mn`
      WITH existingMessageAttachmentPaths(path) AS (
        VALUES
          (${n.path}),
          (${n.thumbnailPath}),
          (${n.screenshotPath})
      )
      INSERT OR REPLACE INTO attachments_protected_from_deletion(path, reuseToken)
      SELECT path, ${r}
      FROM existingMessageAttachmentPaths
      WHERE path IS NOT NULL;
    `;return e.prepare(i).run(c),{...n,reuseToken:r}})()}function Mc(e,{path:n}){let r=(0,o.randomBytes)(16).toString(`hex`),[i,a]=t.mn`
    INSERT OR REPLACE INTO attachments_protected_from_deletion
      (path, reuseToken)
    VALUES
      (${n}, ${r});
  `;return e.prepare(i).run(a),r}function Nc(e,n){let{reuseToken:r}=n;if(!r)return;let{externalAttachments:a}=i.s(n);if(!a.size)return;let[o,s]=t.mn`
    DELETE FROM attachments_protected_from_deletion
    WHERE reuseToken = ${r}
    AND path IN (${t.vn([...a])});
  `;e.prepare(o).run(s)}function Pc(e){e.prepare(`DELETE FROM attachments_protected_from_deletion`).run()}function Fc(e){return e.prepare(`SELECT DISTINCT path FROM attachments_protected_from_deletion`,{pluck:!0}).all()}function Ic(e,n){let[r,i]=t.mn`
    SELECT EXISTS (
      SELECT 1 FROM attachments_protected_from_deletion
        WHERE path = ${n}
      UNION ALL
        SELECT 1 FROM message_attachments
          WHERE
            path = ${n} OR
            thumbnailPath = ${n} OR
            screenshotPath = ${n} OR
            backupThumbnailPath = ${n}
    );
  `;return e.prepare(r,{pluck:!0}).get(i)===0}function Lc(e,n){let[r,i]=t.mn`
    SELECT
      key,
      digest,
      transitCdnKey AS cdnKey,
      transitCdnNumber AS cdnNumber,
      transitCdnUploadTimestamp AS uploadTimestamp,
      incrementalMac,
      incrementalMacChunkSize as chunkSize
    FROM message_attachments
    INDEXED BY message_attachments_plaintextHash
    WHERE
      plaintextHash = ${n} AND
      key IS NOT NULL AND
      digest IS NOT NULL AND
      transitCdnKey IS NOT NULL AND
      transitCdnNumber IS NOT NULL AND
      transitCdnUploadTimestamp IS NOT NULL
    ORDER BY transitCdnUploadTimestamp DESC
    LIMIT 1
  `;return e.prepare(r).get(i)}function Rc(e,n){let[r,i]=t.mn`
    DELETE FROM message_attachments
      WHERE sentAt = ${n};`;e.prepare(r).run(i)}function zc(e,n,r){let{alreadyInTransaction:a,forceSave:o,jobToInsert:s,ourAci:c}=r;if(!a)return e.transaction(()=>zc(e,n,{...r,alreadyInTransaction:!0}))();let{body:l,conversationId:u,id:d,isErased:f,isViewOnce:p,mentionsMe:m,received_at:h,received_at_ms:g,schemaVersion:_,sent_at:v,serverGuid:y,source:b,sourceServiceId:x,sourceDevice:S,storyId:ee,timestamp:te,type:C,readStatus:ne,expireTimer:re,expirationStartTimestamp:ie,seenStatus:ae,serverTimestamp:oe,unidentifiedDeliveryReceived:se,hasUnreadPollVotes:ce,...le}=n,{attachments:ue,groupV2Change:de}=n,fe=ae;ue&&t.Ri(ue.every(e=>!e.data&&!e.screenshotData&&!e.screenshot?.data&&!e.thumbnail?.data),`Attempting to save a message with binary attachment data`),ne===i.nt.Unread&&fe!==i.w.Unseen&&(B.warn(`saveMessage: Message ${d}/${C} is unread but had seenStatus=${fe}. Forcing to UnseenStatus.Unseen.`),n={...n,seenStatus:i.w.Unseen},fe=i.w.Unseen);let w={...le},pe=u!=null&&v!=null;pe||B.error(`saveMessage: saving message without conversationId or sent_at!`,{conversationId:u,sent_at:v});let me=pe&&r._testOnlyAvoidNormalizingAttachments!==!0;me&&(delete w.attachments,delete w.bodyAttachment,delete w.preview,delete w.quote,delete w.contact,delete w.sticker,delete w.editHistory,w.preview=n.preview?.map(e=>z(e,`image`)),w.quote=n.quote?{...n.quote,attachments:n.quote.attachments.map(e=>z(e,`thumbnail`))}:void 0,w.contact=n.contact?.map(e=>({...e,avatar:z(e.avatar,`avatar`)})),w.sticker=n.sticker?z(n.sticker,`data`):void 0,w.editHistory=n.editHistory?.map(e=>{let t={...e};return delete t.attachments,delete t.bodyAttachment,t.quote=e.quote?{...e.quote,attachments:e.quote.attachments.map(e=>z(e,`thumbnail`))}:void 0,t.preview=e.preview?.map(e=>z(e,`image`)),t}));let he=n.attachments?.filter(e=>e.path!=null),ge={id:d,body:l||null,conversationId:u,expirationStartTimestamp:ie||null,expireTimer:re||null,hasAttachments:+((he?.length??0)>0),hasFileAttachments:+!!he?.some(i.Fn),hasVisualMediaAttachments:+!!he?.some(i.Un),hasUnreadPollVotes:+!!ce,isChangeCreatedByUs:+(de?.from===c),isErased:+!!f,isViewOnce:+!!p,mentionsMe:+!!m,received_at:h||null,received_at_ms:g||null,schemaVersion:_||0,serverGuid:y||null,sent_at:v||null,source:b||null,sourceServiceId:x||null,sourceDevice:S||null,storyId:ee||null,type:C||null,timestamp:te??0,readStatus:ne??null,seenStatus:fe??i.w.NotApplicable,serverTimestamp:oe??null,unidentifiedDeliveryReceived:+!!se};if(d&&!o){let r=e.prepare(`
        UPDATE messages SET
          ${t.Kt.map(e=>`${e} = $${e}`).join(`, `)}
        WHERE id = $id;
      `).run({...ge,json:t.un(w)});return r.changes===0?d:(me&&Ac(e,n),s&&X(e,s),t.Ri(r.changes===1,`One row should have been changed`),d)}let _e=d||i.D(n.received_at).id;return e.prepare(`
    INSERT INTO messages (
      ${t.Wt.join(`, `)}
    ) VALUES (
      ${t.Wt.map(e=>`$${e}`).join(`, `)}
    );
    `).run({...ge,id:_e,json:t.un(w)}),me&&Ac(e,n),s&&X(e,s),_e}function Bc(e,t,n){return e.transaction(()=>{let r=[];for(let i of t)r.push(zc(e,i,{...n,alreadyInTransaction:!0}));return r})()}function Vc(e,n,r){try{return Bc(e,n,r),{failedIndices:[]}}catch{B.error(`saveMessagesIndividually: Failed to save messages in one transaction, falling over to individual saves`)}return e.transaction(()=>{let i=[];return n.forEach((n,a)=>{try{zc(e,n,r)}catch(e){B.error(`saveMessagesIndividually: failed to save message`,t.Aa(e)),i.push(a)}}),{failedIndices:i}})()}function Hc(e,t){e.prepare(`DELETE FROM messages WHERE id = $id;`).run({id:t})}function Uc(e,t,n){e.prepare(`
    DELETE FROM messages
    WHERE id IN ( ${t.map(()=>`?`).join(`, `)} );
    `,{persistent:n}).run(t)}function Wc(e,n){t.Xt(e,n,(t,n)=>Uc(e,t,n))}function Gc(e,n){return e.transaction(()=>{let r=e.prepare(`
      SELECT ${t.Wt.join(`, `)}
      FROM messages
      WHERE id = $id;
    `).get({id:n});if(r)return j(e,r)})()}function Kc(e,n){return e.transaction(()=>t.Xt(e,n,(n,r)=>M(e,e.prepare(`
          SELECT ${t.Wt.join(`, `)}
          FROM messages
          WHERE id IN (
            ${Array(n.length).fill(`?`).join(`,`)}
          );`,{persistent:r}).all(n))))()}function qc(e){return e.transaction(()=>M(e,e.prepare(`
      SELECT ${t.Wt.join(`, `)}
      FROM messages ORDER BY id ASC
    `).all()))()}function Jc(e){e.exec(`
    DELETE FROM messages;
    INSERT INTO messages_fts(messages_fts) VALUES('optimize');
  `)}function Yc(e){return e.prepare(`SELECT id FROM messages ORDER BY id ASC;`).all().map(e=>e.id)}function Xc(e,n,r,i,a){return e.transaction(()=>{let o=n===r?t.gn`(messages.sourceServiceId = ${r} OR messages.type IS 'outgoing')`:t.gn`(messages.sourceServiceId = ${r})`,s=t.gn`
      SELECT ${t.Gt}
      FROM edited_messages
      INNER JOIN messages ON
        messages.id = edited_messages.messageId
      WHERE ${o}
        AND edited_messages.sentAt = ${i}
    `,c=t.gn`
      SELECT ${t.Gt}
      FROM messages
      WHERE ${o}
        AND messages.sent_at = ${i}
    `,[l,u]=a.includeEdits?t.mn`${s} UNION ${c} LIMIT 2;`:t.mn`${c} LIMIT 2;`,[d,...f]=e.prepare(l).all(u);return f.length>0&&B.warn(`getMessageByAuthorAciAndSentAt(${r}, ${i}): More than one message found`),d==null?null:j(e,d)})()}function q(e,t){return Zc(e,t).predicate}function Zc(e,n){return n&&e===void 0?{predicate:t.gn`NULL IS NULL`,isFilteringOnStoryId:!1}:{predicate:t.gn`storyId IS ${e??null}`,isFilteringOnStoryId:!0}}function Qc(e,{conversationId:n,includeStoryReplies:r,readMessageReceivedAt:a,storyId:o,readAt:s,now:c=Date.now()}){return e.transaction(()=>{let l=s==null?c:Math.min(c,s),{predicate:u,isFilteringOnStoryId:d}=Zc(o,r),f=t.gn`
      UPDATE messages
      INDEXED BY messages_conversationId_expirationStartTimestamp
      SET
        expirationStartTimestamp = ${l}
      WHERE
        conversationId = ${n} AND
        ${u} AND
        type IS NOT 'outgoing' AND
        type IS NOT 'call-history' AND
        hasExpireTimer IS 1 AND
        received_at <= ${a}
    `,[p,m]=t.mn`
      ${f} AND
        expirationStartTimestamp IS NULL;
    `;e.prepare(p).run(m);let[h,g]=t.mn`
      ${f} AND
        expirationStartTimestamp > ${l};
    `;e.prepare(h).run(g);let _=d?t.gn`messages_unseen_with_story`:t.gn`messages_unseen_no_story`,[v,y]=t.mn`
      SELECT
        id, readStatus, expirationStartTimestamp, sent_at, source, sourceServiceId, type
        FROM messages
        INDEXED BY ${_}
        WHERE
          conversationId = ${n} AND
          seenStatus = ${i.w.Unseen} AND
          isStory = 0 AND
          ${u} AND
          received_at <= ${a}
        ORDER BY received_at DESC, sent_at DESC;
    `,b=e.prepare(v).all(y),[x,S]=t.mn`
      UPDATE messages
        INDEXED BY ${_}
        SET
          readStatus = ${i.nt.Read},
          seenStatus = ${i.w.Seen}
        WHERE
          conversationId = ${n} AND
          seenStatus = ${i.w.Unseen} AND
          isStory = 0 AND
          ${u} AND
          received_at <= ${a};
       `;return e.prepare(x).run(S),b.map(e=>({originalReadStatus:e.readStatus==null?void 0:e.readStatus,readStatus:i.nt.Read,seenStatus:i.w.Seen,id:e.id,expirationStartTimestamp:t.u(e.expirationStartTimestamp),sent_at:e.sent_at||0,source:t.u(e.source),sourceServiceId:t.u(e.sourceServiceId),type:e.type}))})()}function $c(e,{conversationId:t,readMessageReceivedAt:n,storyId:r}){return e.prepare(`
        UPDATE reactions
        INDEXED BY reactions_unread
        SET unread = 0
        WHERE
          conversationId = $conversationId AND
          unread >= 1 AND
          EXISTS (
            SELECT 1
            FROM messages
            WHERE messages.id = reactions.messageId
              AND messages.received_at <= $readMessageReceivedAt
              AND messages.storyId IS $storyId
          )
        RETURNING targetAuthorAci, targetTimestamp, messageId;
      `).all({conversationId:t,readMessageReceivedAt:n,storyId:r||null})}function el(e,t,n){return e.transaction(()=>{let r=e.prepare(`
          SELECT *
          FROM reactions
          WHERE
            targetAuthorAci = $targetAuthorAci AND
            targetTimestamp = $targetTimestamp AND
            unread = 1
          ORDER BY rowId DESC
          LIMIT 1;
        `).get({targetAuthorAci:t,targetTimestamp:n});return e.prepare(`
        UPDATE reactions SET
        unread = 0 WHERE
        targetAuthorAci = $targetAuthorAci AND
        targetTimestamp = $targetTimestamp;
      `).run({targetAuthorAci:t,targetTimestamp:n}),r})()}function tl(e,{conversationId:t,readMessageReceivedAt:n}){return e.transaction(()=>e.prepare(`
        UPDATE messages
        INDEXED BY messages_unread_poll_votes
        SET hasUnreadPollVotes = 0
        WHERE
          conversationId = $conversationId AND
          hasUnreadPollVotes = 1 AND
          received_at <= $readMessageReceivedAt AND
          type IS 'outgoing'
        RETURNING id, conversationId, sent_at AS targetTimestamp, type;
      `).all({conversationId:t,readMessageReceivedAt:n}))()}function nl(e,n){return e.transaction(()=>{let r=e.prepare(`
        UPDATE messages
        SET hasUnreadPollVotes = 0
        WHERE
          sent_at = $sent_at AND
          hasUnreadPollVotes = 1 AND
          type IS 'outgoing'
        RETURNING ${t.Wt.join(`, `)};
      `).get({sent_at:n});if(r)return j(e,r)})()}function rl(e,n,r){let[i,a]=t.mn`
    SELECT * FROM reactions
    WHERE fromId IS ${n} AND timestamp IS ${r}
  `;return e.prepare(i).get(a)}function il(e,{conversationId:t,emoji:n,fromId:r,messageId:a,messageReceivedAt:o,targetAuthorAci:s,targetTimestamp:c,timestamp:l},{readStatus:u}){e.prepare(`INSERT INTO reactions (
      conversationId,
      emoji,
      fromId,
      messageId,
      messageReceivedAt,
      targetAuthorAci,
      targetTimestamp,
      timestamp,
      unread
    ) VALUES (
      $conversationId,
      $emoji,
      $fromId,
      $messageId,
      $messageReceivedAt,
      $targetAuthorAci,
      $targetTimestamp,
      $timestamp,
      $unread
    );`).run({conversationId:t,emoji:n,fromId:r,messageId:a,messageReceivedAt:o,targetAuthorAci:s,targetTimestamp:c,timestamp:l,unread:+(u===i.t.Unread)})}function al(e,{emoji:t,fromId:n,targetAuthorServiceId:r,targetTimestamp:i}){e.prepare(`DELETE FROM reactions WHERE
      emoji = $emoji AND
      fromId = $fromId AND
      targetAuthorAci = $targetAuthorAci AND
      targetTimestamp = $targetTimestamp;`).run({emoji:t,fromId:n,targetAuthorAci:r,targetTimestamp:i})}function ol(e){return e.prepare(`SELECT * from reactions;`).all()}function sl(e){e.prepare(`DELETE from reactions;`).run()}var J=function(e){return e.Older=`Older`,e.Newer=`Newer`,e}(J||{});function cl(e,n,{limit:r=100,messageId:i,receivedAt:a=Number.MAX_VALUE,sentAt:o=Number.MAX_VALUE}={}){let s={first:t.gn`received_at = ${a} AND sent_at < ${o}`,second:t.gn`received_at < ${a}`},c=e=>t.gn`
    SELECT ${t.Gt}
    FROM messages
    WHERE
      (${i??null} IS NULL OR id IS NOT ${i??null}) AND
      isStory IS 0 AND
      storyId IS ${n} AND
      (
        ${e}
      )
  `,[l,u]=t.mn`${t.gn`
    SELECT first.* FROM (${c(s.first)}) as first
    UNION ALL
    SELECT second.* FROM (${c(s.second)}) as second
    ORDER BY received_at DESC, sent_at DESC
  `} LIMIT ${r}`;return e.transaction(()=>M(e,e.prepare(l).all(u)))()}function ll(e,n,{conversationId:r,includeStoryReplies:i,limit:a=100,messageId:o,receivedAt:s=n===J.Older?Number.MAX_VALUE:0,sentAt:c=n===J.Older?Number.MAX_VALUE:0,requireVisualMediaAttachments:l,requireFileAttachments:u,storyId:d}){let f,p;n===J.Older?(f={first:t.gn`received_at = ${s} AND sent_at < ${c}`,second:t.gn`received_at < ${s}`},p=t.gn`DESC`):(f={first:t.gn`received_at = ${s} AND sent_at > ${c}`,second:t.gn`received_at > ${s}`},p=t.gn`ASC`);let m=n===J.Older||l||u,h=e=>t.gn`
    SELECT ${t.Gt}
    FROM messages WHERE
      conversationId = ${r} AND
      ${m?t.gn`(${o??null} IS NULL OR id IS NOT ${o??null}) AND`:t.gn``}
      ${l?t.gn`hasVisualMediaAttachments IS 1 AND isViewOnce IS 0 AND`:t.gn``}
      ${u?t.gn`hasFileAttachments IS 1 AND isViewOnce IS 0 AND`:t.gn``}
      isStory IS 0 AND
      (${q(d,i)}) AND
      (
        ${e}
      )
      ORDER BY received_at ${p}, sent_at ${p}
  `,[g,_]=t.mn`
    SELECT first.* FROM (${h(f.first)}) as first
    UNION ALL
    SELECT second.* FROM (${h(f.second)}) as second
    LIMIT ${a}
  `;return e.transaction(()=>{let t=e.prepare(g).all(_);return n===J.Older&&t.reverse(),M(e,t)})()}function ul(e,t){return ll(e,J.Older,t)}function dl(e,{conversationId:n,sourceServiceId:r}){return e.transaction(()=>{let[i,a]=t.mn`
    SELECT ${t.Gt}
    FROM messages
    WHERE
      isStory = 1 AND
      (${n??null} IS NULL OR
        conversationId IS ${n??null}) AND
      (${r??null} IS NULL OR
        sourceServiceId IS ${r??null})
    ORDER BY received_at ASC, sent_at ASC;
  `,o=e.prepare(i).all(a),[s,c]=t.mn`
    SELECT DISTINCT storyId
    FROM messages
    WHERE storyId IS NOT NULL
  `,l=e.prepare(s,{pluck:!0}).all(c),[u,d]=t.mn`
    SELECT DISTINCT storyId
    FROM messages
    WHERE (
      storyId IS NOT NULL AND
      type IS 'outgoing'
    )
  `,f=e.prepare(u,{pluck:!0}).all(d),p=new Set(l),m=new Set(f);return M(e,o).map(e=>({...e,hasReplies:p.has(e.id),hasRepliesFromSelf:m.has(e.id)}))})()}function fl(e,t){return ll(e,J.Newer,t)}function pl(e,n,{storyId:r,includeStoryReplies:i}){let[a,o]=t.mn`
    SELECT received_at, sent_at, id FROM messages WHERE
        conversationId = ${n} AND
        isStory IS 0 AND
        (${q(r,i)})
      ORDER BY received_at ASC, sent_at ASC
      LIMIT 1;
  `,s=e.prepare(a).get(o);if(s)return s}function ml(e,n,{storyId:r,includeStoryReplies:i}){let[a,o]=t.mn`
    SELECT received_at, sent_at, id FROM messages WHERE
        conversationId = ${n} AND
        isStory IS 0 AND
        (${q(r,i)})
      ORDER BY received_at DESC, sent_at DESC
      LIMIT 1;
  `,s=e.prepare(a).get(o);if(s)return s}function hl(e,n,r){let{after:i,before:a,includeStoryReplies:o}=r,[s,c]=t.mn`
    SELECT id
    FROM messages
    WHERE
      conversationId = ${n} AND
      (${q(void 0,o)}) AND
      isStory IS 0 AND
      (
        received_at > ${i.received_at}
        OR (received_at = ${i.received_at} AND sent_at > ${i.sent_at})
      ) AND (
        received_at < ${a.received_at}
        OR (received_at = ${a.received_at} AND sent_at < ${a.sent_at})
      )
    ORDER BY received_at ASC, sent_at ASC;
  `;return e.prepare(s).all(c).map(e=>e.id)}function gl(e,{conversationId:n,lastSelectedMessage:r,deletedMessageIds:i,storyId:a,includeStoryReplies:o}){function s(s){let c=s?t.gn`ASC`:t.gn`DESC`,l=s?t.gn`>`:t.gn`<`,{received_at:u,sent_at:d}=r,[f,p]=t.mn`
      SELECT id FROM messages WHERE
        conversationId = ${n} AND
        (${q(a,o)}) AND
        isStory IS 0 AND
        id NOT IN (${t.vn(i)}) AND
        type IN ('incoming', 'outgoing')
        AND (
          (received_at = ${u} AND sent_at ${l} ${d}) OR
          received_at ${l} ${u}
        )
      ORDER BY received_at ${c}, sent_at ${c}
      LIMIT 1
    `;return e.prepare(f,{pluck:!0}).get(p)}return s(!0)??s(!1)??null}function _l(e,{conversationId:n,includeStoryReplies:r}){return e.transaction(()=>{let i=e.prepare(`
      SELECT ${t.Wt.join(`, `)} FROM messages
      INDEXED BY messages_activity
      WHERE
        conversationId IS $conversationId AND
        shouldAffectActivity IS 1 AND
        isTimerChangeFromSync IS 0 AND
        ${r?``:`storyId IS NULL AND`}
        isGroupLeaveEventFromOther IS 0
      ORDER BY received_at DESC, sent_at DESC
      LIMIT 1;
      `).get({conversationId:n});if(i)return j(e,i)})()}function vl(e,{conversationId:n,includeStoryReplies:r}){let i=r?`messages_preview`:`messages_preview_without_story`;return e.transaction(()=>{let a=e.prepare(`
      SELECT ${t.Wt.join(`, `)}, expiresAt FROM (
        SELECT ${t.Wt.join(`, `)}, expiresAt FROM messages
        INDEXED BY ${i}
        WHERE
          conversationId IS $conversationId AND
          shouldAffectPreview IS 1 AND
          isGroupLeaveEventFromOther IS 0
          ${r?``:`AND storyId IS NULL`}
        ORDER BY received_at DESC, sent_at DESC
      )
      WHERE likely(expiresAt > $now)
      LIMIT 1
    `).get({conversationId:n,now:Date.now()});return a?j(e,a):void 0})()}function yl(e,{conversationId:t,includeStoryReplies:n}){return e.transaction(()=>({activity:_l(e,{conversationId:t,includeStoryReplies:n}),preview:vl(e,{conversationId:t,includeStoryReplies:n}),hasUserInitiatedMessages:yc(e,t)}))()}function bl(e,{conversationId:n}){return e.transaction(()=>{let r=e.prepare(`
      SELECT ${t.Wt.join(`, `)} FROM messages WHERE
        conversationId = $conversationId
      ORDER BY received_at DESC, sent_at DESC
      LIMIT 1;
      `).get({conversationId:n});if(r)return j(e,r)})()}function xl(e,n,{storyId:r,includeStoryReplies:a}){let[o,s]=t.mn`
    SELECT received_at, sent_at, id FROM messages WHERE
      conversationId = ${n} AND
      seenStatus = ${i.w.Unseen} AND
      isStory IS 0 AND
      (${q(r,a)})
    ORDER BY received_at ASC, sent_at ASC
    LIMIT 1;
  `,c=e.prepare(o).get(s);if(c)return c}function Sl(e,n,r){let[a,o]=t.mn`
      SELECT received_at, sent_at, id FROM messages WHERE
        conversationId = ${n} AND
        readStatus = ${i.nt.Unread} AND
        mentionsMe IS 1 AND
        isStory IS 0 AND
        (${q(r.storyId,r.includeStoryReplies)})
      ORDER BY received_at ASC, sent_at ASC
      LIMIT 1;
      `;return e.prepare(a).get(o)}function Cl(e,n,{storyId:r,includeStoryReplies:a}){let[o,s]=t.mn`
    SELECT count(1)
    FROM messages
    WHERE
      conversationId = ${n} AND
      readStatus = ${i.nt.Unread} AND
      isStory IS 0 AND
      (${q(r,a)})
  `;return e.prepare(o,{pluck:!0}).get(s)??0}function wl(e,n,{storyId:r,includeStoryReplies:a}){let[o,s]=t.mn`
    SELECT count(1)
    FROM messages
    WHERE
      conversationId = ${n} AND
      readStatus = ${i.nt.Unread} AND
      mentionsMe IS 1 AND
      isStory IS 0 AND
      (${q(r,a)})
  `;return e.prepare(o,{pluck:!0}).get(s)??0}function Tl(e,n,{storyId:r,includeStoryReplies:a}){let[o,s]=t.mn`
    SELECT count(1)
      FROM messages
      WHERE
        conversationId = ${n} AND
        seenStatus = ${i.w.Unseen} AND
        isStory IS 0 AND
        (${q(r,a)})
  `;return e.prepare(o,{pluck:!0}).get(s)??0}function El(e,t){let{conversationId:n}=t;return{oldest:pl(e,n,t),newest:ml(e,n,t),oldestUnseen:xl(e,n,t),totalUnseen:Tl(e,n,t)}}function Dl(e,t){return e.transaction(()=>({older:ll(e,J.Older,t),newer:ll(e,J.Newer,t),metrics:El(e,t)}))()}function Ol(e){let[n]=t.mn`
    SELECT * FROM callsHistory;
  `;return e.prepare(n).all()}function kl(e){let[n,r]=t.mn`
    DELETE FROM callsHistory;
  `;e.prepare(n).run(r)}function Al(e,n){return e.transaction(()=>{let r=Gl(e,n);if(r==null)return B.warn(`clearCallHistory: Target call not found`),[];let{timestamp:a}=r,[o,s]=t.mn`
      SELECT roomId
      FROM callLinks
      WHERE callLinks.adminKey IS NOT NULL;
    `,[c,l]=t.mn`
      SELECT callsHistory.callId
      FROM callsHistory
      WHERE
        (
          -- Prior calls
          (callsHistory.timestamp <= ${a})
          -- Unused call links
          OR (
            callsHistory.mode IS ${Vl} AND
            callsHistory.status IS ${zl}
          )
        ) AND
        callsHistory.peerId NOT IN (${t.vn(e.prepare(o,{pluck:!0}).all(s))});
    `,u=e.prepare(c,{pluck:!0}).all(l),d=[];return t.Xt(e,u,(n,r)=>{let a=t.vn(n),[o,s]=t.mn`
        UPDATE callsHistory
        SET
          status = ${i._t.Deleted},
          timestamp = ${Date.now()}
        WHERE callsHistory.callId IN (${a});
      `;e.prepare(o,{persistent:r}).run(s);let[c,l]=t.mn`
        DELETE FROM messages
        WHERE messages.type IS 'call-history'
        AND messages.callId IN (${a})
        RETURNING id;
      `,u=e.prepare(c,{pluck:!0,persistent:r}).all(l);d=d.concat(u)}),d})()}function jl(e,n){let[r,a]=t.mn`
    UPDATE callsHistory
    SET
      status = ${i._t.Deleted},
      timestamp = ${Date.now()}
    WHERE callId = ${n}
  `;e.prepare(r).run(a)}function Ml(e){return e.transaction(()=>{let[n,r]=t.mn`
        DELETE FROM messages
        WHERE messages.id IN (
          SELECT messages.id FROM messages
          LEFT JOIN callsHistory ON callsHistory.callId IS messages.callId
          WHERE messages.type IS 'call-history'
          AND callsHistory.status IS ${Rl}
        )
      `;e.prepare(n).run(r)})()}function Nl(e,n){return e.transaction(()=>{let[r,i]=t.mn`
    SELECT ${t.Gt}
    FROM messages
    WHERE conversationId = ${n.conversationId}
      AND type = 'call-history'
      AND callId = ${n.callId}
  `,a=e.prepare(r).get(i);if(a!=null)return j(e,a)})()}function Pl(e,n,r){let[a,o]=t.mn`
    SELECT * FROM callsHistory
    WHERE callId IS ${n}
    AND peerId IS ${r};
  `,s=e.prepare(a).get(o);if(s!=null)return t.da(i.wt,s)}const Fl=t.hn(i.nt.Read),Il=t.hn(i.w.Unseen),Ll=t.hn(i.w.Seen),Y=t.hn(i.mt.Missed),Rl=t.hn(i.mt.Deleted),zl=t.hn(i.mt.Pending),Bl=t.hn(i.ut.Incoming),Vl=t.hn(i.pt.Adhoc),Hl=t.hn(14400*1e3);function Ul(e){let[n,r]=t.mn`
    SELECT DISTINCT(messages.conversationId) FROM messages
    INNER JOIN callsHistory ON callsHistory.callId = messages.callId
    WHERE messages.type IS 'call-history'
      AND messages.seenStatus IS ${Il}
      AND callsHistory.direction IS ${Bl}
  `;return e.prepare(n,{pluck:!0}).all(r)}function Wl(e){let[n,r]=t.mn`
    SELECT count(*) FROM messages
    INNER JOIN callsHistory ON callsHistory.callId = messages.callId
    WHERE messages.type IS 'call-history'
      AND messages.seenStatus IS ${Il}
      AND callsHistory.direction IS ${Bl}
  `;return e.prepare(n,{pluck:!0}).get(r)??0}function Gl(e,n){let{callId:r,timestamp:a}=n;if(`peerId`in n){let{peerId:o}=n,s;if(r==null||o==null){let[r,i]=t.mn`
        SELECT *
        FROM callsHistory
        WHERE ${o==null?t.gn`TRUE`:t.gn`callsHistory.peerId IS ${n.peerId}`}
          AND callsHistory.timestamp <= ${a}
        ORDER BY callsHistory.timestamp DESC
        LIMIT 1
      `;s=e.prepare(r).get(i)}else{let[r,i]=t.mn`
        SELECT *
        FROM callsHistory
        WHERE callsHistory.peerId IS ${n.peerId}
          AND callsHistory.callId IS ${n.callId}
        LIMIT 1
      `;s=e.prepare(r).get(i)}return s==null?null:t.da(i.wt,s)}if(`peerIdAsConversationId`in n&&`peerIdAsRoomId`in n)return Gl(e,{callId:r,timestamp:a,peerId:n.peerIdAsConversationId})||Gl(e,{callId:r,timestamp:a,peerId:n.peerIdAsRoomId})||null;throw Error(`Either peerId, or peerIdAsConversationId and peerIdAsRoomId must be present`)}function Kl(e,n){let{peerId:r,mode:a}=n;if(a===i.pt.Adhoc)throw Error(`getConversationIdForCallHistory: Adhoc calls do not have conversations`);let[o,s]=t.mn`
    SELECT id FROM conversations
    WHERE ${a===i.pt.Direct?t.gn`serviceId IS ${r}`:t.gn`groupId IS ${r}`}
  `,c=e.prepare(o,{pluck:!0}).get(s);return typeof c==`string`?c??null:(B.warn(`getConversationIdForCallHistory: Unknown conversation`),null)}function ql(e,n,r){let[i,a]=t.mn`
    SELECT messages.received_at
    FROM messages
    WHERE messages.type IS 'call-history'
      AND messages.conversationId IS ${r}
      AND messages.callId IS ${n}
    LIMIT 1
  `,o=e.prepare(i,{pluck:!0}).get(a);if(o==null){B.warn(`getMessageReceivedAtForCall: Target call message not found`);return}return o}function Jl(e,n,r){let[a,o]=t.mn`
    UPDATE messages
    SET
      readStatus = ${Fl},
      seenStatus = ${Ll},
      json = json_patch(json, ${JSON.stringify({readStatus:i.nt.Read,seenStatus:i.w.Seen})}),
      expirationStartTimestamp = CASE
        WHEN messages.hasExpireTimer IS 1
          AND messages.expirationStartTimestamp IS NULL
        THEN
          ${r}
        ELSE
          expirationStartTimestamp
      END
    WHERE messages.type IS 'call-history'
    AND messages.callId IS ${n}
    RETURNING
      messages.id,
      messages.conversationId,
      messages.readStatus,
      messages.seenStatus,
      messages.expirationStartTimestamp
  `;return e.prepare(a).get(o)??null}function Yl(e,n,r,a,o=!1){return e.transaction(()=>{let s=Gl(e,n);if(s==null)return B.warn(`markAllCallHistoryRead: Target call not found`),[];let{callId:c}=s;t.Ri(n.callId==null||c===n.callId,`Call ID must be the same as target if supplied`);let l,u;if(s.mode===i.pt.Adhoc)t.Ri(!o,`markAllCallHistoryRead: Not possible to mark read in conversation for Adhoc calls`),u=s.timestamp,l=t.gn`TRUE`;else{let n=Kl(e,s);if(n==null)return B.warn(`markAllCallHistoryRead: Conversation not found for call`),[];B.info(`markAllCallHistoryRead: Found conversation ${n}`),u=ql(e,c,n),l=o?t.gn`messages.conversationId IS ${n}`:t.gn`TRUE`}if(u==null)return B.warn(`markAllCallHistoryRead: Message not found for call`),[];let d=JSON.stringify({readStatus:i.nt.Read,seenStatus:i.w.Seen});B.info(`markAllCallHistoryRead: Marking calls before ${u} read`);let f=t.gn`
      RETURNING
        messages.id,
        messages.conversationId,
        messages.readStatus,
        messages.seenStatus,
        messages.expirationStartTimestamp
    `,[p,m]=t.mn`
      UPDATE messages
      SET
        readStatus = ${Fl},
        seenStatus = ${Ll},
        json = json_patch(json, ${d})
      WHERE messages.type IS 'call-history'
        AND ${l}
        AND messages.seenStatus IS ${Il}
        AND messages.received_at <= ${u}
      ${f}
    `,h=e.prepare(p).all(m),[g,_]=t.mn`
      UPDATE messages
      SET
        expirationStartTimestamp = ${r}
      WHERE messages.type IS 'call-history'
        AND ${l}
        AND messages.seenStatus IS ${Ll}
        AND messages.received_at <= ${u}
        AND hasExpireTimer IS 1
        AND expirationStartTimestamp IS NULL
        AND messages.callId NOT IN (${t.vn(Array.from(a))})
      ${f}
    `,v=e.prepare(g).all(_),y=new Set,b=[];for(let e of v)y.add(e.id),b.push(e);for(let e of h)y.has(e.id)||b.push(e);return b})()}function Xl(e,t,n,r){return Yl(e,t,n,r,!0)}function Zl(e,n,r,a){return e.transaction(()=>{let{limit:o,offset:s}=a,{status:c,conversationIds:l,callLinkRoomIds:u}=r,d=l!=null||u!=null;if(d){let[n]=t.mn`
        CREATE TEMP TABLE temp_callHistory_filtered_peers (
          conversationId TEXT,
          serviceId TEXT,
          groupId TEXT,
          callLinkRoomId TEXT
        );
      `;e.exec(n),l!=null&&(t.Ri(l.length>0,`can't filter by empty array`),t.Xt(e,l,(n,r)=>{let[i,a]=t.mn`
            INSERT INTO temp_callHistory_filtered_peers
              (conversationId, serviceId, groupId)
            SELECT id, serviceId, groupId
            FROM conversations
            WHERE conversations.id IN (${t.vn(n.map(e=>t.gn`${e}`))});
          `;e.prepare(i,{persistent:r}).run(a)})),u!=null&&(t.Ri(u.length>0,`can't filter by empty array`),t.Xt(e,u,(n,r)=>{let[i,a]=t.mn`
            INSERT INTO temp_callHistory_filtered_peers
              (callLinkRoomId)
            VALUES ${t.vn(n.map(e=>t.gn`(${e})`))};
          `;e.prepare(i,{persistent:r}).run(a)}))}let f=d?t.gn`
          INNER JOIN temp_callHistory_filtered_peers ON (
            temp_callHistory_filtered_peers.conversationId IS c.peerId
            OR temp_callHistory_filtered_peers.serviceId IS c.peerId
            OR temp_callHistory_filtered_peers.groupId IS c.peerId
            OR temp_callHistory_filtered_peers.callLinkRoomId IS c.peerId
          )
        `:t.gn``,p=c===i.dt.All?t.gn`status IS NOT ${Rl}`:t.gn`
            direction IS ${Bl} AND
            status IS ${Y} AND status IS NOT ${Rl}
          `,m=o>0?t.gn`LIMIT ${o} OFFSET ${s}`:t.gn``,[h,g]=t.mn`
      SELECT
        ${n?t.gn`COUNT(*) OVER() AS count`:t.gn`peerId, ringerId, mode, type, direction, status, timestamp, possibleChildren, inPeriod`}
      FROM (
        -- 1. 'callAndGroupInfo': This section collects metadata to determine the
        -- parent and children of each call. We can identify the real parents of calls
        -- within the query, but we need to build the children at runtime.
        WITH callAndGroupInfo AS (
          SELECT
            *,
            -- 1a. 'possibleParent': This identifies the first call that _could_ be
            -- considered the current call's parent. Note: The 'possibleParent' is not
            -- necessarily the true parent if there is another call between them that
            -- isn't a part of the group.
            (
              SELECT callId
              FROM callsHistory
              WHERE
                callsHistory.direction IS c.direction
                AND callsHistory.type IS c.type
                AND callsHistory.peerId IS c.peerId
                AND (callsHistory.timestamp - ${Hl}) <= c.timestamp
                AND callsHistory.timestamp >= c.timestamp
                -- Tracking Android & Desktop separately to make the queries easier to compare
                -- Android Constraints:
                AND (
                  (callsHistory.status IS c.status AND callsHistory.status IS ${Y}) OR
                  (callsHistory.status IS NOT ${Y} AND c.status IS NOT ${Y})
                )
                -- Desktop Constraints:
                AND callsHistory.status IS c.status
                AND ${p}
              ORDER BY timestamp DESC
            ) as possibleParent,
            -- 1b. 'possibleChildren': This identifies all possible calls that can
            -- be grouped with the current call. Note: This current call is not
            -- necessarily the parent, and not all possible children will end up as
            -- children as they might have another parent
            (
              SELECT JSON_GROUP_ARRAY(
                JSON_OBJECT(
                  'callId', callsHistory.callId,
                  'timestamp', callsHistory.timestamp
                )
              )
              FROM callsHistory
              WHERE
                callsHistory.direction IS c.direction
                AND callsHistory.type IS c.type
                AND callsHistory.peerId IS c.peerId
                AND (c.timestamp - ${Hl}) <= callsHistory.timestamp
                AND c.timestamp >= callsHistory.timestamp
                -- Tracking Android & Desktop separately to make the queries easier to compare
                -- Android Constraints:
                AND (
                  (callsHistory.status IS c.status AND callsHistory.status IS ${Y}) OR
                  (callsHistory.status IS NOT ${Y} AND c.status IS NOT ${Y})
                )
                -- Desktop Constraints:
                AND callsHistory.status IS c.status
                AND ${p}
              ORDER BY callsHistory.timestamp DESC
            ) as possibleChildren,

            -- 1c. 'inPeriod': This identifies all calls in a time period after the
            -- current call. They may or may not be a part of the group.
            (
              SELECT GROUP_CONCAT(callId)
              FROM callsHistory
              WHERE
                (c.timestamp - ${Hl}) <= callsHistory.timestamp
                AND c.timestamp >= callsHistory.timestamp
                AND ${p}
            ) AS inPeriod
          FROM callsHistory AS c
          ${f}
          WHERE
            ${p}
          ORDER BY timestamp DESC
        )
        -- 2. 'isParent': We need to identify the true parent of the group in cases
        -- where the previous call is not a part of the group.
        SELECT
          *,
          CASE
            WHEN LAG (possibleParent, 1, 0) OVER (
              -- Note: This is an optimization assuming that we've already got 'timestamp DESC' ordering
              -- from the query above. If we find that ordering isn't always correct, we can uncomment this:
              -- ORDER BY timestamp DESC
            ) != possibleParent THEN callId
            ELSE possibleParent
          END AS parent
        FROM callAndGroupInfo
      ) AS parentCallAndGroupInfo
      WHERE parent = parentCallAndGroupInfo.callId
      GROUP BY
        CASE
          -- By spec, limit adhoc call history to the most recent call
          WHEN mode IS ${Vl} THEN peerId
          ELSE callId
        END
      ORDER BY parentCallAndGroupInfo.timestamp DESC
      ${m};
    `,_=n?e.prepare(h,{pluck:!0}).get(g):e.prepare(h).all(g);if(d){let[n]=t.mn`
        DROP TABLE temp_callHistory_filtered_peers;
      `;e.exec(n)}return _})()}const Ql=t.Za().int().nonnegative();function $l(e,n){let r=Zl($o(e,`only temp table use`),!0,n,{limit:0,offset:0});return r==null?0:t.da(Ql,r)}const eu=t.Ha(i.Et.omit({children:!0}).extend({possibleChildren:t.to(),inPeriod:t.to()})),tu=t.Ha(i.Tt);function nu(e,n,r){let a=t.da(eu,Zl($o(e,`only temp table use`),!1,n,r)),o=new Set;return a.map(e=>({...e,possibleChildren:t.da(tu,JSON.parse(e.possibleChildren)),inPeriod:new Set(e.inPeriod.split(`,`))})).reverse().map(e=>{let{possibleChildren:n,inPeriod:r,type:a,...s}=e,c=[];for(let e of n)if(!o.has(e.callId)&&r.has(e.callId)&&(c.push(e),o.add(e.callId),a===i.ht.Adhoc))break;return t.ua(i.Et,{...s,type:a,children:c})}).reverse()}function ru(e,n){let[r,i]=t.mn`
    INSERT OR REPLACE INTO callsHistory (
      callId,
      peerId,
      ringerId,
      startedById,
      mode,
      type,
      direction,
      status,
      timestamp,
      endedTimestamp
    ) VALUES (
      ${n.callId},
      ${n.peerId},
      ${n.ringerId},
      ${n.startedById},
      ${n.mode},
      ${n.type},
      ${n.direction},
      ${n.status},
      ${n.timestamp},
      ${n.endedTimestamp}
    );
  `;e.prepare(r).run(i)}function iu(e,t,n){return e.prepare(`
      SELECT EXISTS(
        SELECT 1 FROM messages
        WHERE conversationId = $conversationId
        AND type = 'call-history'
        AND json_extract(json, '$.callHistoryDetails.callMode') = 'Group'
        AND json_extract(json, '$.callHistoryDetails.eraId') = $eraId
      );
      `,{pluck:!0}).get({conversationId:t,eraId:n})===1}function au(e,n,r){let[i,a]=t.mn`
    SELECT messages.callId FROM messages
    INNER JOIN callsHistory ON callsHistory.callId = messages.callId
    WHERE messages.conversationId = ${n}
      AND messages.type IS 'call-history'
      AND messages.seenStatus IS ${Il}
      AND callsHistory.direction IS ${Bl}
      AND messages.received_at <= ${r}
    ORDER BY messages.received_at DESC, messages.sent_at DESC
    LIMIT 1
  `;return e.prepare(i,{pluck:!0}).get(a)??null}function ou(e,n){return e.transaction(()=>{let r,i,a;{let[i,a]=t.mn`
        SELECT EXISTS(
          SELECT 1 FROM message_attachments
          INDEXED BY message_attachments_getOlderMedia
          WHERE
            conversationId IS ${n} AND
            editHistoryIndex IS -1 AND
            attachmentType IS 'attachment' AND
            messageType IN ('incoming', 'outgoing') AND
            isViewOnce IS NOT 1 AND
            contentType IS NOT NULL AND
            contentType IS NOT '' AND
            contentType IS NOT 'text/x-signal-plain'
        );
      `;r=e.prepare(i,{pluck:!0}).get(a)===1}{let[r,a]=t.mn`
        SELECT EXISTS(
          SELECT 1 FROM messages
          INDEXED BY messages_hasPreviews
          WHERE
            conversationId IS ${n} AND
            type IN ('incoming', 'outgoing') AND
            isViewOnce IS NOT 1 AND
            hasPreviews IS 1
        );
      `;i=e.prepare(r,{pluck:!0}).get(a)===1}{let[r,i]=t.mn`
        SELECT EXISTS(
          SELECT 1 FROM messages
          INDEXED BY messages_hasContacts
          WHERE
            conversationId IS ${n} AND
            type IN ('incoming', 'outgoing') AND
            isViewOnce IS NOT 1 AND
            hasContacts IS 1
        );
      `;a=e.prepare(r,{pluck:!0}).get(i)===1}return r||i||a})()}const{VOICE_MESSAGE:su}=t.o.signalservice.AttachmentPointer.Flags;function cu(e,{order:r,conversationId:i,limit:a,messageId:o,receivedAt:s,sentAt:c,size:l,type:u}){let d,f,p;if(r===`older`){let e=s??Number.MAX_VALUE,n=c??Number.MAX_VALUE;d=t.gn`message_attachments_getOlderMedia`,f={first:t.gn`
        message_attachments.receivedAt = ${e}
        AND
        message_attachments.sentAt < ${n}
      `,second:t.gn`message_attachments.receivedAt < ${e}`},p=t.gn`
      message_attachments.receivedAt DESC,
      message_attachments.sentAt DESC
    `}else if(r===`newer`){let e=s??Number.MIN_VALUE,n=c??Number.MIN_VALUE;d=t.gn`message_attachments_getOlderMedia`,f={first:t.gn`
        message_attachments.receivedAt = ${e}
        AND
        message_attachments.sentAt > ${n}
      `,second:t.gn`message_attachments.receivedAt > ${e}`},p=t.gn`
      message_attachments.receivedAt ASC,
      message_attachments.sentAt ASC
    `}else if(r===`bigger`){let e=l??Number.MAX_VALUE,n=s??Number.MAX_VALUE,r=c??Number.MAX_VALUE;d=t.gn`message_attachments_sortBiggerMedia`,f={first:t.gn`
        message_attachments.size = ${e}
        AND
        message_attachments.receivedAt = ${n}
        AND
        message_attachments.sentAt < ${r}
      `,second:t.gn`
        message_attachments.size = ${e}
        AND
        message_attachments.receivedAt < ${n}
      `,third:t.gn`
        message_attachments.size < ${e}
      `},p=t.gn`
      message_attachments.size DESC,
      message_attachments.receivedAt DESC,
      message_attachments.sentAt DESC
    `}else throw n.p(r);let m;if(u===`media`)m=t.gn`
      message_attachments.flags IS NOT ${su} AND
      (
        message_attachments.contentType LIKE 'image/%' OR
        message_attachments.contentType LIKE 'video/%'
      )
    `;else if(u===`audio`)m=t.gn`
      message_attachments.flags IS ${su} OR
      message_attachments.contentType LIKE 'audio/%'
    `;else if(u===`documents`)m=t.gn`
      message_attachments.flags IS NOT ${su} AND
      message_attachments.contentType IS NOT 'text/x-signal-plain' AND
      message_attachments.contentType NOT LIKE 'audio/%' AND
      message_attachments.contentType NOT LIKE 'image/%' AND
      message_attachments.contentType NOT LIKE 'video/%'
    `;else throw n.p(u);let h=e=>t.gn`
    SELECT
      message_attachments.*,
      messages.json -> '$.sendStateByConversationId' AS messageSendState,
      messages.json -> '$.errors' AS messageErrors,
      messages.isErased AS messageIsErased,
      messages.readStatus AS messageReadStatus,
      messages.source AS messageSource,
      messages.sourceServiceId AS messageSourceServiceId
    FROM message_attachments
    INDEXED BY ${d}
    INNER JOIN messages ON
      messages.id = message_attachments.messageId
    WHERE
      message_attachments.conversationId IS ${i} AND
      message_attachments.editHistoryIndex IS -1 AND
      message_attachments.attachmentType IS 'attachment' AND
      (
        ${e}
      ) AND
      (${m}) AND
      message_attachments.isViewOnce IS NOT 1 AND
      message_attachments.messageType IN ('incoming', 'outgoing') AND
      (${o??null} IS NULL OR message_attachments.messageId IS NOT ${o??null})
      ORDER BY ${p}
      LIMIT ${a}
  `,g;if(r===`older`||r===`newer`)g=t.mn`
      SELECT first.* FROM (${h(f.first)}) as first
      UNION ALL
      SELECT second.* FROM (${h(f.second)}) as second
    `;else if(r===`bigger`)t.Ri(f.third!=null,`file size filter is required`),g=t.mn`
      SELECT first.* FROM (${h(f.first)}) as first
      UNION ALL
      SELECT second.* FROM (${h(f.second)}) as second
      UNION ALL
      SELECT third.* FROM (${h(f.third)}) as third
    `;else throw n.p(r);let[_,v]=g;return e.prepare(_).all(v).map(e=>{let{orderInMessage:t,messageType:n,messageSource:r,messageSourceServiceId:a,messageSendState:o,messageErrors:s,messageIsErased:c,messageReadStatus:l,sentAt:u,receivedAt:d,receivedAtMs:f}=e;return{type:`mediaItem`,message:{id:e.messageId,type:n,source:r??void 0,sourceServiceId:a??void 0,conversationId:i,receivedAt:d,receivedAtMs:f??void 0,sentAt:u,sendStateByConversationId:o==null?void 0:JSON.parse(o),errors:s==null?void 0:JSON.parse(s),isErased:c===1,readStatus:l??void 0},index:t,attachment:N(e)}})}function lu(e,{conversationId:r,limit:i,messageId:a,receivedAt:o=Number.MAX_VALUE,sentAt:s=Number.MAX_VALUE,type:c}){let l={first:t.gn`received_at = ${o} AND sent_at < ${s}`,second:t.gn`received_at < ${o}`},u,d;if(c===`links`)u=t.gn`messages_hasPreviews`,d=t.gn`hasPreviews IS 1`;else if(c===`contacts`)u=t.gn`messages_hasContacts`,d=t.gn`hasContacts IS 1`;else throw n.p(c);let f=e=>t.gn`
    SELECT ${t.Gt}
    FROM messages
    INDEXED BY ${u}
    WHERE
      conversationId IS ${r} AND
      (${d}) AND
      isViewOnce IS NOT 1 AND
      type IN ('incoming', 'outgoing') AND
      (${a??null} IS NULL OR id IS NOT ${a??null})
      AND (${e})
      ORDER BY received_at DESC, sent_at DESC
      LIMIT ${i}
  `,[p,m]=t.mn`
    SELECT first.* FROM (${f(l.first)}) as first
    UNION ALL
    SELECT second.* FROM (${f(l.second)}) as second
  `;return M(e,e.prepare(p).all(m)).map(e=>{let i={id:e.id,type:e.type,conversationId:r,source:e.source,sourceServiceId:e.sourceServiceId,receivedAt:e.received_at,receivedAtMs:e.received_at_ms??void 0,sentAt:e.sent_at,errors:t.u(e.errors),sendStateByConversationId:e.sendStateByConversationId,readStatus:e.readStatus,isErased:!!e.isErased};if(c===`links`){let n=e.preview?.[0];return t.Ri(n,`getSortedNonAttachmentMedia: got message without preview ${e.id}`),{type:`link`,message:i,preview:n}}if(c===`contacts`){let n=e.contact?.[0];return t.Ri(n,`getSortedNonAttachmentMedia: got message without contact ${e.id}`),{type:`contact`,message:i,contact:n}}throw n.p(c)})}function uu(e,t){return e.transaction(()=>{let n=cu(e,{...t,order:`older`,type:`documents`}),r=lu(e,{...t,type:`contacts`});return m.default.orderBy(n.concat(r),[e=>e.message.receivedAt,e=>e.message.sentAt],[`desc`,`desc`]).slice(0,t.limit)})()}function du(e,n){t.Xt(e,n,(n,r)=>{let[a,o]=t.mn`
      UPDATE callsHistory
      SET status = ${t.hn(i.vt.Missed)}
      WHERE callId IN (${t.vn(n)})
    `;return e.prepare(a,{persistent:r}).run(o)})}function fu(e,t){return e.transaction(()=>du(e,t))()}function pu(e){return e.transaction(()=>{let[n,r]=t.mn`
      SELECT callId, peerId FROM callsHistory
      WHERE
        type = ${t.hn(i.ht.Group)} AND
        status = ${t.hn(i.vt.Ringing)}
      ORDER BY timestamp DESC
    `,a=e.prepare(n).all(r),o=new Set,[s,c]=Po(a,e=>o.size>=10||o.has(e.peerId)?!1:(o.add(e.peerId),!0));return du(e,c.map(e=>e.callId)),s})()}function mu(e,t,n){let r=1e3,i=e.prepare(`
    SELECT
      rowid,
      json -> '$.sendStateByConversationId' AS sendStateJson,
      json -> '$.editHistory' AS editHistoryJson
    FROM messages
    WHERE conversationId IS $obsoleteId
    ORDER BY rowid
    LIMIT $pageSize OFFSET $offset`),a=e.prepare(`
    UPDATE messages
    SET
      conversationId = $currentId,
      json = json_patch(json, $patch)
    WHERE
      rowid IS $rowid
  `);e.transaction(()=>{for(let e=0;;e+=r){let o=i.all({obsoleteId:t,pageSize:r,offset:e});for(let{rowid:e,sendStateJson:r,editHistoryJson:i}of o){let o=JSON.parse(i||`[]`),s=JSON.parse(r||`{}`),c={conversationId:n,sendStateByConversationId:{[t]:null,[n]:s[t]},editHistory:o.map(({sendStateByConversationId:e,...r})=>{let i=e?.[t];return i?{...r,sendStateByConversationId:{...e,[t]:void 0,[n]:i}}:r})};a.run({rowid:e,patch:JSON.stringify(c),currentId:n})}if(o.length<r)break}})()}function hu(e,n){return e.transaction(()=>{let[r,i]=t.mn`
      SELECT ${t.Gt}
      FROM edited_messages
      INNER JOIN messages ON
        messages.id = edited_messages.messageId
      WHERE edited_messages.sentAt = ${n}
      UNION
      SELECT ${t.Gt}
      FROM messages
      WHERE sent_at = ${n}
      ORDER BY messages.received_at DESC, messages.sent_at DESC;
    `;return M(e,e.prepare(r).all(i))})()}function gu(e){return e.transaction(()=>{let n=Date.now();return M(e,e.prepare(`
      SELECT ${t.Wt.join(`, `)}, expiresAt
      FROM messages
      WHERE
        expiresAt <= $now
      ORDER BY expiresAt ASC;
      `).all({now:n}))})()}function _u(e){return e.transaction(()=>M(e,e.prepare(`
      SELECT ${t.Wt.join(`, `)} FROM messages
      INDEXED BY messages_unexpectedly_missing_expiration_start_timestamp
      WHERE
        expireTimer > 0 AND
        expirationStartTimestamp IS NULL AND (
          readStatus = ${i.nt.Read} OR
          readStatus = ${i.nt.Viewed} OR
          readStatus IS NULL
        )
      `).all()))()}function vu(e){let t=e.prepare(`
      SELECT MIN(expiresAt)
      FROM messages;
      `,{pluck:!0}).get();if(!(t!=null&&t>=2**53-1))return t||void 0}function yu(e){return e.transaction(()=>{let n=e.prepare(`
      SELECT ${t.Wt.join(`, `)} FROM messages
      WHERE
        -- we want this query to use the messages_view_once index rather than received_at
        likelihood(isViewOnce = 1, 0.01)
        AND (isErased IS NULL OR isErased != 1)
      ORDER BY received_at ASC, sent_at ASC
      LIMIT 1;
      `).get();if(!n)return;let r=j(e,n).received_at_ms;return i.sr(r)?r:void 0})()}function bu(e,n){return e.transaction(()=>M(e,e.prepare(`
      SELECT ${t.Wt.join(`, `)}
      FROM messages
      WHERE
        isViewOnce = 1
        AND (isErased IS NULL OR isErased != 1)
        AND (
          IFNULL(received_at_ms, 0) <= $maxTimestamp
        )
      `).all({maxTimestamp:n})))()}function xu(e,t){let{id:n,timestamp:r,receivedAtDate:i,receivedAtCounter:a,attempts:o,type:s,isEncrypted:c,content:l,messageAgeSec:u,source:d,sourceServiceId:f,sourceDevice:p,destinationServiceId:m,updatedPni:h,serverGuid:g,serverTimestamp:_,urgent:v,story:y,reportingToken:b,groupId:x}=t;if(!n)throw Error(`saveUnprocessed: id was falsey`);return e.prepare(`
    INSERT OR REPLACE INTO unprocessed (
      id,
      timestamp,
      receivedAtCounter,
      receivedAtDate,
      attempts,
      type,
      isEncrypted,
      content,

      messageAgeSec,
      source,
      sourceServiceId,
      sourceDevice,
      destinationServiceId,
      updatedPni,
      serverGuid,
      serverTimestamp,
      urgent,
      story,
      reportingToken,
      groupId
    ) values (
      $id,
      $timestamp,
      $receivedAtCounter,
      $receivedAtDate,
      $attempts,
      $type,
      $isEncrypted,
      $content,

      $messageAgeSec,
      $source,
      $sourceServiceId,
      $sourceDevice,
      $destinationServiceId,
      $updatedPni,
      $serverGuid,
      $serverTimestamp,
      $urgent,
      $story,
      $reportingToken,
      $groupId
    );
    `).run({id:n,timestamp:r,receivedAtCounter:a,receivedAtDate:i,attempts:o,type:s,isEncrypted:+!!c,content:l,messageAgeSec:u,source:d||null,sourceServiceId:f||null,sourceDevice:p||null,destinationServiceId:m,updatedPni:h||null,serverGuid:g,serverTimestamp:_,urgent:v||!Do(v)?1:0,story:+!!y,reportingToken:b||null,groupId:x||null}),n}function Su(e){return t.rn(e,`unprocessed`)}function Cu(e){return e.transaction(()=>{let{changes:n}=e.prepare(`DELETE FROM unprocessed WHERE receivedAtDate < $messageQueueCutoff`).run({messageQueueCutoff:Date.now()-45*t.Pn});n!==0&&B.warn(`getAllUnprocessedAndIncrementAttempts: deleting ${n} old unprocessed envelopes`);let{changes:r}=e.prepare(`
          DELETE FROM unprocessed
          WHERE attempts >= $MAX_UNPROCESSED_ATTEMPTS
        `).run({MAX_UNPROCESSED_ATTEMPTS:10});return r!==0&&B.warn(`getAllUnprocessedAndIncrementAttempts: deleting ${r} invalid unprocessed envelopes`),e.prepare(`
      SELECT id
      FROM unprocessed
      ORDER BY receivedAtCounter ASC
    `,{pluck:!0}).all()})()}function wu(e,n){return B.info(`getUnprocessedByIdsAndIncrementAttempts`,{totalIds:n.length}),t.Xt(e,n,(t,n)=>e.prepare(`
          UPDATE unprocessed
          SET attempts = attempts + 1
          WHERE id IN (${t.map(()=>`?`).join(`, `)})
        `,{persistent:n}).run(t)),t.Xt(e,n,(t,n)=>e.prepare(`
          SELECT *
          FROM unprocessed
          WHERE id IN (${t.map(()=>`?`).join(`, `)})
          ORDER BY receivedAtCounter ASC;
        `,{persistent:n}).all(t).map(e=>({...e,urgent:R(e.urgent)?!!e.urgent:!0,story:!!e.story,isEncrypted:!!e.isEncrypted})))}function Tu(e,t,n){e.prepare(`
    DELETE FROM unprocessed
    WHERE id IN ( ${t.map(()=>`?`).join(`, `)} );
    `,{persistent:n}).run(t)}function Eu(e,n){if(!Array.isArray(n)){e.prepare(`DELETE FROM unprocessed WHERE id = $id;`).run({id:n});return}n.length&&t.Xt(e,n,(t,n)=>Tu(e,t,n))}function Du(e){e.prepare(`DELETE FROM unprocessed;`).run()}function Ou(e,n){let[r,i]=t.mn`
    SELECT * FROM attachment_downloads
    WHERE
      messageId = ${n.messageId}
    AND
      attachmentType = ${n.attachmentType}
    AND
      attachmentSignature = ${n.attachmentSignature};
  `,a=e.prepare(r).get(i);if(a===void 0)return;let{attachmentJson:o,...s}=a;return t.da(t.Rt,{...s,active:!!a.active,attachment:JSON.parse(o),ciphertextSize:a.ciphertextSize||0})}function ku(e){let[n,r]=t.mn`
    DELETE FROM attachment_downloads
    WHERE
      source = ${t.Ht.BACKUP_IMPORT_WITH_MEDIA}
    OR
      source = ${t.Ht.BACKUP_IMPORT_NO_MEDIA};`;e.prepare(n).run(r)}function Au(e){let[n,r]=t.mn`
    INSERT OR REPLACE INTO attachment_downloads_backup_stats
      (id, totalBytes, completedBytes)
    VALUES
      (0,0,0);
  `;e.prepare(n).run(r)}function ju(e){let[n,r]=t.mn`
    SELECT totalBytes, completedBytes FROM attachment_downloads_backup_stats
    WHERE id = 0;
  `;return e.prepare(n).get(r)??{totalBytes:0,completedBytes:0}}function Mu(e,{limit:n,sources:r,prioritizeMessageIds:i,timestamp:a=Date.now(),maxLastAttemptForPrioritizedMessages:o}){let s=[],c=r?t.gn`
      source IN (${t.vn(r)})
    `:t.gn`
      TRUE
    `;if(i?.length){let[r,l]=t.mn`
      SELECT * FROM attachment_downloads
      -- very few rows will match messageIds, so in this case we want to optimize
      -- the WHERE clause rather than the ORDER BY
      INDEXED BY attachment_downloads_active_messageId
      WHERE
        active = 0
      AND
        -- for priority messages, we want to retry based on the last attempt, rather than retryAfter
        (lastAttemptTimestamp is NULL OR lastAttemptTimestamp <= ${o??a-36e5})
      AND
        messageId IN (${t.vn(i)})
      AND
        ${c}
      -- for priority messages, let's load them oldest first; this helps, e.g. for stories where we
      -- want the oldest one first
      ORDER BY receivedAt ASC
      LIMIT ${n}
    `;s=e.prepare(r).all(l)}let l=n-s.length,u=[];if(l>0){let[n,r]=t.mn`
      SELECT * FROM attachment_downloads
      WHERE
        active = 0
      AND
        (retryAfter is NULL OR retryAfter <= ${a})
      AND
        ${c}
      ORDER BY receivedAt DESC
      LIMIT ${l}
    `;u=e.prepare(n).all(r)}let d=s.concat(u);try{return d.map(n=>{try{return t.da(t.Rt,{...n,active:!!n.active,attachment:t.ln(n.attachmentJson)})}catch(t){throw B.error(`getNextAttachmentDownloadJobs: Error with job for message ${n.messageId}, deleting.`),Lu(e,n),Error(t)}})}catch(t){if(`message`in t&&t.message===`jsonToObject or SchemaParse error`)return Mu(e,{limit:n,prioritizeMessageIds:i,timestamp:a,maxLastAttemptForPrioritizedMessages:o});throw t}}function Nu(e,t){let n=[];if(e.transaction(()=>{for(let r of t)try{Pu(e,r)}catch(e){n.push(e)}})(),n.length!==0)throw n.length===1?n[0]:AggregateError(n,`Multiple errors while saving attachment download jobs:\n ${n.map(e=>e.message).join(`
`)}`)}function Pu(e,n){return e.transaction(()=>{let[r,i]=t.mn`
      SELECT EXISTS(
        SELECT 1 FROM messages
        WHERE messages.id = ${n.messageId}
      );
    `;if(e.prepare(r,{pluck:!0}).get(i)!==1){B.warn(`saveAttachmentDownloadJob: message does not exist, bailing`);return}let a={messageId:n.messageId,attachmentType:n.attachmentType,attachmentSignature:n.attachmentSignature,receivedAt:n.receivedAt,sentAt:n.sentAt,contentType:n.contentType,size:n.size,active:+!!n.active,attempts:n.attempts,retryAfter:n.retryAfter,lastAttemptTimestamp:n.lastAttemptTimestamp,attachmentJson:t.un(n.attachment),ciphertextSize:n.ciphertextSize,originalSource:n.originalSource,source:n.source};e.prepare(`
      INSERT INTO attachment_downloads
        (${Io.join(`, `)})
      VALUES
        (${Io.map(e=>`$${e}`).join(`, `)})
      ON CONFLICT DO UPDATE SET
          -- preserve originalSource
          ${Io.filter(e=>e!==`originalSource`).map(e=>`${e} = $${e}`).join(`, `)}
    `).run(a)})()}function Fu(e){e.prepare(`
    UPDATE attachment_downloads
    SET active = 0
    WHERE active != 0;
    `).run()}function Iu(e){e.prepare(`
    UPDATE attachment_downloads
    SET retryAfter = NULL
    WHERE originalSource = 'backup_import'
    `).run()}function Lu(e,n){let[r,i]=t.mn`
    DELETE FROM attachment_downloads
    WHERE
      messageId = ${n.messageId}
    AND
      attachmentType = ${n.attachmentType}
    AND
      attachmentSignature = ${n.attachmentSignature};
  `;e.prepare(r).run(i)}function Ru(e,n){let[r,i]=t.mn`
    DELETE FROM attachment_downloads
    WHERE messageId = ${n}
  `;e.prepare(r).run(i)}function zu(e){e.prepare(`DELETE FROM attachment_backup_jobs;`).run()}function Bu(e){e.prepare(`
    UPDATE attachment_backup_jobs
    SET active = 0;
    `).run()}function Vu(e,n){let[r,i]=t.mn`
    INSERT OR REPLACE INTO attachment_backup_jobs (
      active,
      attempts,
      data,
      lastAttemptTimestamp,
      mediaName,
      receivedAt,
      retryAfter,
      type
    ) VALUES (
      ${+!!n.active},
      ${n.attempts},
      ${t.un(n.data)},
      ${n.lastAttemptTimestamp},
      ${n.mediaName},
      ${n.receivedAt},
      ${n.retryAfter},
      ${n.type}
    );
  `;e.prepare(r).run(i)}function Hu(e,{limit:n,timestamp:r=Date.now()}){let[i,a]=t.mn`
    SELECT * FROM attachment_backup_jobs
    WHERE
      active = 0
    AND
      (retryAfter is NULL OR retryAfter <= ${r})
    ORDER BY
      -- type is "standard" or "thumbnail"; we prefer "standard" jobs
      type ASC, receivedAt DESC
    LIMIT ${n}
  `;return e.prepare(i).all(a).map(n=>{let r=t.ha(Ri,{...n,active:!!n.active,data:t.ln(n.data)});if(!r.success){let i=t.wa(n.mediaName);return B.error(`getNextAttachmentBackupJobs: invalid data, removing. mediaName: ${i}`,t.Aa(r.error)),Uu(e,{mediaName:n.mediaName}),null}return r.data}).filter(t._a)}function Uu(e,n){let[r,i]=t.mn`
    DELETE FROM attachment_backup_jobs
    WHERE
      mediaName = ${n.mediaName};
  `;e.prepare(r).run(i)}function Wu(e){e.prepare(`DELETE FROM backup_cdn_object_metadata;`).run()}function Gu(e,n){e.transaction(()=>{for(let r of n){let{mediaId:n,cdnNumber:i,sizeOnBackupCdn:a}=r,[o,s]=t.mn`
        INSERT OR REPLACE INTO backup_cdn_object_metadata
        (
          mediaId,
          cdnNumber,
          sizeOnBackupCdn
        ) VALUES (
          ${n},
          ${i},
          ${a}
        );
      `;e.prepare(o).run(s)}})()}function Ku(e,n){let[r,i]=t.mn`
    SELECT * FROM backup_cdn_object_metadata
    WHERE mediaId = ${n}
  `;return e.prepare(r).get(i)}function qu(e,t){let{attemptedStatus:n,author:r,coverStickerId:i,createdAt:a,downloadAttempts:o,id:s,installedAt:c,key:l,lastUsed:u,status:d,stickerCount:f,title:p}=t;if(!s)throw Error(`createOrUpdateStickerPack: Provided data did not have a truthy id`);let m=e.prepare(`
      SELECT id
      FROM sticker_packs
      WHERE id = $id;
      `).get({id:s}),h={attemptedStatus:n??null,author:r,coverStickerId:i,createdAt:a||Date.now(),downloadAttempts:o||1,id:s,installedAt:c??null,key:l,lastUsed:u||null,status:d,stickerCount:f,title:p};if(m){e.prepare(`
      UPDATE sticker_packs SET
        attemptedStatus = $attemptedStatus,
        author = $author,
        coverStickerId = $coverStickerId,
        createdAt = $createdAt,
        downloadAttempts = $downloadAttempts,
        installedAt = $installedAt,
        key = $key,
        lastUsed = $lastUsed,
        status = $status,
        stickerCount = $stickerCount,
        title = $title
      WHERE id = $id;
      `).run(h);return}let{position:g}=t;R(g)||(g=e.prepare(`
    SELECT IFNULL(MAX(position) + 1, 0)
    FROM sticker_packs
    `,{pluck:!0}).get()),e.prepare(`
    INSERT INTO sticker_packs (
      attemptedStatus,
      author,
      coverStickerId,
      createdAt,
      downloadAttempts,
      id,
      installedAt,
      key,
      lastUsed,
      status,
      stickerCount,
      title,
      position
    ) values (
      $attemptedStatus,
      $author,
      $coverStickerId,
      $createdAt,
      $downloadAttempts,
      $id,
      $installedAt,
      $key,
      $lastUsed,
      $status,
      $stickerCount,
      $title,
      $position
    )
    `).run({...h,position:g??0})}function Ju(e,t){e.transaction(()=>{for(let n of t)qu(e,n)})()}function Yu(e,n,r,i){let a=i&&i.timestamp||Date.now(),o=r===`installed`?a:null,s=i?.position;return e.transaction(()=>{let[i,a]=t.mn`
      SELECT status FROM sticker_packs WHERE id IS ${n};
    `,c=e.prepare(i,{pluck:!0}).get(a)??null;return s==null?e.prepare(`
        UPDATE sticker_packs
        SET
          status = $status,
          installedAt = $installedAt
        WHERE id = $id;
        `).run({id:n,status:r,installedAt:o}):e.prepare(`
        UPDATE sticker_packs
        SET
          status = $status,
          installedAt = $installedAt,
          position = $position
        WHERE id = $id;
        `).run({id:n,status:r,installedAt:o,position:s}),c})()}function Xu(e,{id:t,storageID:n,storageVersion:r,storageUnknownFields:i,storageNeedsSync:a,uninstalledAt:o,position:s}){o?e.prepare(`
      UPDATE uninstalled_sticker_packs
      SET
        storageID = $storageID,
        storageVersion = $storageVersion,
        storageUnknownFields = $storageUnknownFields,
        storageNeedsSync = $storageNeedsSync
      WHERE id = $id;
      `).run({id:t,storageID:n??null,storageVersion:r??null,storageUnknownFields:i??null,storageNeedsSync:+!!a}):e.prepare(`
      UPDATE sticker_packs
      SET
        storageID = $storageID,
        storageVersion = $storageVersion,
        storageUnknownFields = $storageUnknownFields,
        storageNeedsSync = $storageNeedsSync,
        position = $position
      WHERE id = $id;
      `).run({id:t,storageID:n??null,storageVersion:r??null,storageUnknownFields:i??null,storageNeedsSync:+!!a,position:s||0})}function Zu(e,n){return e.transaction(()=>{for(let r of n){let[n,i]=t.mn`
        UPDATE sticker_packs
        SET
          position = ${r.position},
          storageNeedsSync = 1
        WHERE id = ${r.id}
      `;e.prepare(n).run(i)}})()}function Qu(e){e.prepare(`
    UPDATE sticker_packs
    SET downloadAttempts = 0
    WHERE status = 'error';
    `).run()}function $u(e,t){let{emoji:n,height:r,id:i,isCoverOnly:a,lastUsed:o,packId:s,path:c,width:l,version:u,localKey:d,size:f}=t;if(!R(i))throw Error(`createOrUpdateSticker: Provided data did not have a numeric id`);if(!s)throw Error(`createOrUpdateSticker: Provided data did not have a truthy id`);e.prepare(`
    INSERT OR REPLACE INTO stickers (
      emoji,
      height,
      id,
      isCoverOnly,
      lastUsed,
      packId,
      path,
      width,
      version,
      localKey,
      size
    ) values (
      $emoji,
      $height,
      $id,
      $isCoverOnly,
      $lastUsed,
      $packId,
      $path,
      $width,
      $version,
      $localKey,
      $size
    )
    `).run({emoji:n??null,height:r,id:i,isCoverOnly:+!!a,lastUsed:o||null,packId:s,path:c,width:l,version:u||1,localKey:d||null,size:f||null})}function ed(e,t){e.transaction(()=>{for(let n of t)$u(e,n)})()}function td(e,t,n,r){e.prepare(`
    UPDATE stickers
    SET lastUsed = $lastUsed
    WHERE id = $id AND packId = $packId;
    `).run({id:n,packId:t,lastUsed:r}),e.prepare(`
    UPDATE sticker_packs
    SET lastUsed = $lastUsed
    WHERE id = $id;
    `).run({id:t,lastUsed:r})}function nd(e,{messageId:n,packId:r,stickerId:i,isUnresolved:a}){if(!n)throw Error(`addStickerPackReference: Provided data did not have a truthy messageId`);if(!r)throw Error(`addStickerPackReference: Provided data did not have a truthy packId`);e.transaction(()=>{let[o,s]=t.mn`
      SELECT EXISTS (
        SELECT 1 FROM sticker_packs WHERE id IS ${r}
      )
    `;if(e.prepare(o,{pluck:!0}).get(s)!==1){B.warn(`addStickerPackReference: did not find referenced pack`);return}let[c,l]=t.mn`
      INSERT OR REPLACE INTO sticker_references (
        messageId,
        packId,
        stickerId,
        isUnresolved
      ) values (
        ${n},
        ${r},
        ${i},
        ${+!!a}
      )
    `;e.prepare(c).run(l)})()}function rd(e,{messageId:t,packId:n}){return e.transaction(()=>{if(e.prepare(`
        DELETE FROM sticker_references
        WHERE messageId = $messageId AND packId = $packId;
        `).run({messageId:t,packId:n}),(e.prepare(`
      SELECT count(1) FROM sticker_references
      WHERE packId = $packId;
      `,{pluck:!0}).get({packId:n})??0)>0)return;let r=e.prepare(`
          SELECT status FROM sticker_packs
          WHERE id = $packId;
          `).get({packId:n});if(!r){B.warn(`deleteStickerPackReference: did not find referenced pack`);return}let{status:i}=r;if(i===`installed`)return;let a=e.prepare(`
          SELECT path FROM stickers
          WHERE packId = $packId;
          `).all({packId:n});return e.prepare(`
        DELETE FROM sticker_packs
        WHERE id = $packId;
        `).run({packId:n}),(a||[]).map(e=>e.path)})()}function id(e,n){return e.transaction(()=>{let[r,i]=t.mn`
      UPDATE sticker_references
      SET isUnresolved = 0
      WHERE packId IS ${n} AND isUnresolved IS 1
      RETURNING messageId, stickerId;
    `;return e.prepare(r).all(i).map(({messageId:e,stickerId:t})=>({messageId:e,packId:n,stickerId:t,isUnresolved:!0}))})()}function ad(e,t){if(!t)throw Error(`deleteStickerPack: Provided data did not have a truthy packId`);return e.transaction(()=>{let n=e.prepare(`
          SELECT path FROM stickers
          WHERE packId = $packId;
          `).all({packId:t});return e.prepare(`
        DELETE FROM sticker_packs
        WHERE id = $packId;
        `).run({packId:t}),(n||[]).map(e=>e.path)})()}function od(e){return t.rn(e,`stickers`)}function sd(e){return e.prepare(`
      SELECT * FROM sticker_packs
      ORDER BY position ASC, id ASC
      `).all().map(e=>({...e,storageNeedsSync:e.storageNeedsSync===1,stickers:{},author:String(e.author),title:String(e.title)}))}function cd(e,t){e.prepare(`
      INSERT OR REPLACE INTO uninstalled_sticker_packs
      (
        id, uninstalledAt, storageID, storageVersion, storageUnknownFields,
        storageNeedsSync
      )
      VALUES
      (
        $id, $uninstalledAt, $storageID, $storageVersion, $unknownFields,
        $storageNeedsSync
      )
    `).run({id:t.id,uninstalledAt:t.uninstalledAt,storageID:t.storageID??null,storageVersion:t.storageVersion??null,unknownFields:t.storageUnknownFields??null,storageNeedsSync:+!!t.storageNeedsSync})}function ld(e,t){return e.transaction(()=>{for(let n of t)cd(e,n)})()}function ud(e,n){let[r,i]=t.mn`
    DELETE FROM uninstalled_sticker_packs WHERE id IS ${n}
  `;e.prepare(r).run(i)}function dd(e){return e.prepare(`SELECT * FROM uninstalled_sticker_packs ORDER BY id ASC`).all().map(e=>({...e,storageNeedsSync:e.storageNeedsSync===1}))}function fd(e){return e.prepare(`
      SELECT *
      FROM sticker_packs
      WHERE
        status IS 'installed' OR
        storageID IS NOT NULL
      ORDER BY id ASC
      `).all().map(e=>({...e,storageNeedsSync:e.storageNeedsSync===1,stickers:{}}))}function pd(e,t){return e.transaction(()=>{let n=e.prepare(`
        SELECT * FROM uninstalled_sticker_packs
        WHERE id IS $packId
        `).get({packId:t});if(n)return{...n,storageNeedsSync:n.storageNeedsSync===1,key:void 0,position:void 0};let r=e.prepare(`
        SELECT
          id, key, position, storageID, storageVersion, storageUnknownFields
        FROM sticker_packs
        WHERE id IS $packId
        `).get({packId:t});if(r)return{...r,storageNeedsSync:r.storageNeedsSync===1,uninstalledAt:void 0}})()}function md(e,n,r,i){return e.transaction(()=>{ud(e,n);let a=i??e.prepare(`
          SELECT IFNULL(MAX(position) + 1, 0)
          FROM sticker_packs
          WHERE id != $packId
        `,{pluck:!0}).get({packId:n})??0;if(Yu(e,n,`installed`,{position:a,timestamp:r})===`installed`)return{wasPreviouslyUninstalled:!1};let[o,s]=t.mn`
      UPDATE sticker_packs SET
        storageNeedsSync = 1
      WHERE id IS ${n};
    `;return e.prepare(o).run(s),{wasPreviouslyUninstalled:!0,position:a}})()}function hd(e,n,r){return e.transaction(()=>{let i=Yu(e,n,`downloaded`)===`installed`,[a,o]=t.mn`
      UPDATE sticker_packs SET
        storageID = NULL,
        storageVersion = NULL,
        storageUnknownFields = NULL,
        storageNeedsSync = 0
      WHERE id = ${n}
    `;return e.prepare(a).run(o),cd(e,{id:n,uninstalledAt:r,storageNeedsSync:i}),i})()}function gd(e){return(e.prepare(`
      SELECT * FROM stickers
      ORDER BY packId ASC, id ASC
      `).all()||[]).map(e=>Bo(e))}function _d(e,{limit:t}={}){return(e.prepare(`
      SELECT stickers.* FROM stickers
      JOIN sticker_packs on stickers.packId = sticker_packs.id
      WHERE stickers.lastUsed > 0 AND sticker_packs.status = 'installed'
      ORDER BY stickers.lastUsed DESC
      LIMIT $limit
      `).all({limit:t||24})||[]).map(e=>Bo(e))}function vd(e,n){let[r,i]=t.mn`
    INSERT OR REPLACE INTO recentEmojis (
      emoji,
      lastUsedAt
    ) VALUES (
      ${n},
      ${Date.now()}
    )
  `;e.prepare(r).run(i)}function yd(e,n){let[r,i]=t.mn`
    SELECT emoji FROM recentEmojis
    ORDER BY lastUsedAt DESC
    LIMIT ${n}
  `;return e.prepare(r,{pluck:!0}).all(i)}const bd=t.Qa({id:t.to(),title:t.to(),description:t.to(),previewMedia_url:t.to(),previewMedia_width:t.Za().int(),previewMedia_height:t.Za().int(),attachmentMedia_url:t.to(),attachmentMedia_width:t.Za().int(),attachmentMedia_height:t.Za().int(),lastUsedAt:t.Za().int()});function xd(e,n){let[r,i]=t.mn`
    SELECT * FROM recentGifs
    ORDER BY lastUsedAt DESC
    LIMIT ${n}
  `;return e.prepare(r).all(i).map(e=>{let n=t.da(bd,e);return{id:n.id,title:n.title,description:n.description,previewMedia:{url:n.previewMedia_url,width:n.previewMedia_width,height:n.previewMedia_height},attachmentMedia:{url:n.attachmentMedia_url,width:n.attachmentMedia_width,height:n.attachmentMedia_height}}})}function Sd(e,n,r,i){let[a,o]=t.mn`
    INSERT OR REPLACE INTO recentGifs (
      id,
      title,
      description,
      previewMedia_url,
      previewMedia_width,
      previewMedia_height,
      attachmentMedia_url,
      attachmentMedia_width,
      attachmentMedia_height,
      lastUsedAt
    ) VALUES (
      ${n.id},
      ${n.title},
      ${n.description},
      ${n.previewMedia.url},
      ${n.previewMedia.width},
      ${n.previewMedia.height},
      ${n.attachmentMedia.url},
      ${n.attachmentMedia.width},
      ${n.attachmentMedia.height},
      ${r}
    );
  `,[s,c]=t.mn`
    DELETE FROM recentGifs
    WHERE id NOT IN (
      SELECT id FROM recentGifs
      ORDER BY lastUsedAt DESC
      LIMIT ${i}
    );
  `;e.transaction(()=>{e.prepare(a).run(o),e.prepare(s).run(c)})()}function Cd(e,n){let[r,i]=t.mn`
    DELETE FROM recentGifs
    WHERE id = ${n}
  `;e.prepare(r).run(i)}function wd(e){return e.transaction(()=>{let n=e.prepare(`SELECT * FROM badges`).all(),r=e.prepare(`SELECT * FROM badgeImageFiles`).all(),a=new Map;for(let e of r){let{badgeId:n,order:r,localPath:o,url:s,theme:c}=e,l=a.get(n)||[];l[r]={...l[r],[i.rr(c)]:{localPath:t.u(o),url:s}},a.set(n,l)}return n.map(e=>({id:e.id,category:i.ar(e.category),name:e.name,descriptionTemplate:e.descriptionTemplate,images:(a.get(e.id)||[]).filter(t._a)}))})()}function Td(e,t){let n=e.prepare(`
    INSERT OR REPLACE INTO badges (
      id,
      category,
      name,
      descriptionTemplate
    ) VALUES (
      $id,
      $category,
      $name,
      $descriptionTemplate
    );
    `),r=e.prepare(`SELECT url, localPath FROM badgeImageFiles WHERE badgeId = $badgeId`),i=e.prepare(`
    INSERT INTO badgeImageFiles (
      badgeId,
      'order',
      url,
      localPath,
      theme
    ) VALUES (
      $badgeId,
      $order,
      $url,
      $localPath,
      $theme
    );
    `);e.transaction(()=>{t.forEach(e=>{let{id:t}=e,a=new Map;for(let{url:e,localPath:n}of r.all({badgeId:t}))n&&a.set(e,n);n.run({id:t,category:e.category,name:e.name,descriptionTemplate:e.descriptionTemplate});for(let[n,r]of e.images.entries())for(let[e,o]of Object.entries(r))i.run({badgeId:t,localPath:o.localPath||a.get(o.url)||null,order:n,theme:e,url:o.url})})})()}function Ed(e,t,n){e.prepare(`UPDATE badgeImageFiles SET localPath = $localPath WHERE url = $url`).run({url:t,localPath:n})}function Dd(e){let t=e.prepare(`SELECT localPath FROM badgeImageFiles WHERE localPath IS NOT NULL`,{pluck:!0}).all();return new Set(t)}function Od(e,n=!1){let r=!0;try{let t=e.pragma(`integrity_check`);t.length===1&&t.at(0)?.integrity_check===`ok`?B.info(`runCorruptionChecks: general integrity is ok`):(B.error(`runCorruptionChecks: general integrity is not ok`,t),r=!1)}catch(e){B.error(`runCorruptionChecks: general integrity check error`,t.Aa(e)),r=!1}try{e.exec(`INSERT INTO messages_fts(messages_fts) VALUES('integrity-check')`),B.info(`runCorruptionChecks: FTS5 integrity ok`)}catch(i){if(B.error(`runCorruptionChecks: FTS5 integrity check error.`,t.Aa(i)),r=!1,!n){try{e.exec(`INSERT INTO messages_fts(messages_fts) VALUES('rebuild');`),B.info(`runCorruptionChecks: FTS5 index rebuilt`)}catch(e){return B.error(`runCorruptionChecks: FTS5 recovery failed`,t.Aa(e)),!1}return B.info(`runCorruptionChecks: retrying`),Od(e,!0)}}return r}function kd(e){return{...z(e,`senderKeyInfoJson`),allowsReplies:!!e.allowsReplies,deletedAtTimestamp:e.deletedAtTimestamp||void 0,isBlockList:!!e.isBlockList,senderKeyInfo:e.senderKeyInfoJson?JSON.parse(e.senderKeyInfoJson):void 0,storageID:e.storageID||void 0,storageVersion:e.storageVersion||void 0,storageNeedsSync:!!e.storageNeedsSync,storageUnknownFields:e.storageUnknownFields||void 0}}function Ad(e){return{...z(e,`senderKeyInfo`),allowsReplies:+!!e.allowsReplies,deletedAtTimestamp:e.deletedAtTimestamp||null,isBlockList:+!!e.isBlockList,senderKeyInfoJson:e.senderKeyInfo?JSON.stringify(e.senderKeyInfo):null,storageID:e.storageID||null,storageVersion:e.storageVersion||null,storageNeedsSync:+!!e.storageNeedsSync,storageUnknownFields:e.storageUnknownFields||null}}function jd(e){return e.prepare(`SELECT * FROM storyDistributions;`).all().map(kd)}function Md(e){return e.prepare(`SELECT * FROM storyDistributionMembers;`).all()}function Nd(e){e.prepare(`DELETE FROM storyDistributions;`).run()}function Pd(e,n){t.Ri(n.name,`Distribution list does not have a valid name`),e.transaction(()=>{let t=Ad(n);e.prepare(`
      INSERT INTO storyDistributions(
        id,
        name,
        deletedAtTimestamp,
        allowsReplies,
        isBlockList,
        senderKeyInfoJson,
        storageID,
        storageVersion,
        storageUnknownFields,
        storageNeedsSync
      ) VALUES (
        $id,
        $name,
        $deletedAtTimestamp,
        $allowsReplies,
        $isBlockList,
        $senderKeyInfoJson,
        $storageID,
        $storageVersion,
        $storageUnknownFields,
        $storageNeedsSync
      );
      `).run(t);let{id:r,members:i}=n,a=e.prepare(`
      INSERT OR REPLACE INTO storyDistributionMembers (
        listId,
        serviceId
      ) VALUES (
        $listId,
        $serviceId
      );
      `);for(let e of i)a.run({listId:r,serviceId:e})})()}function Fd(e){let t=jd(e),n=Eo(Md(e),e=>e.listId);return t.map(e=>({...e,members:(n[e.id]||[]).map(e=>e.serviceId)}))}function Id(e,t){let n=e.prepare(`SELECT * FROM storyDistributions WHERE id = $id;`).get({id:t});if(!n)return;let r=e.prepare(`SELECT serviceId FROM storyDistributionMembers WHERE listId = $id;`).all({id:t});return{...kd(n),members:r.map(({serviceId:e})=>e)}}function Ld(e,n){let r=Ad(n);r.deletedAtTimestamp?t.Ri(!r.name,`Attempt to delete distribution list but still has a name`):t.Ri(r.name,`Cannot clear distribution list name without deletedAtTimestamp set`),e.prepare(`
    UPDATE storyDistributions
    SET
      name = $name,
      deletedAtTimestamp = $deletedAtTimestamp,
      allowsReplies = $allowsReplies,
      isBlockList = $isBlockList,
      senderKeyInfoJson = $senderKeyInfoJson,
      storageID = $storageID,
      storageVersion = $storageVersion,
      storageUnknownFields = $storageUnknownFields,
      storageNeedsSync = $storageNeedsSync
    WHERE id = $id
    `).run(r)}function Rd(e,n,{toAdd:r,toRemove:i}){let a=e.prepare(`
    INSERT OR REPLACE INTO storyDistributionMembers (
      listId,
      serviceId
    ) VALUES (
      $listId,
      $serviceId
    );
    `);for(let e of r)a.run({listId:n,serviceId:e});t.Xt(e,i,(r,i)=>{let[a,o]=t.mn`
        DELETE FROM storyDistributionMembers
        WHERE listId = ${n} AND serviceId IN (${t.vn(r)});
      `;e.prepare(a,{persistent:i}).run(o)})}function zd(e,t,{toAdd:n,toRemove:r}){n.length||r.length?e.transaction(()=>{Ld(e,t),Rd(e,t.id,{toAdd:n,toRemove:r})})():Ld(e,t)}function Bd(e,t){e.prepare(`DELETE FROM storyDistributions WHERE id = $id;`).run({id:t})}function Vd(e){return e.prepare(`SELECT * FROM storyReads;`).all()}function Hd(e){e.prepare(`DELETE FROM storyReads;`).run()}function Ud(e,t){e.prepare(`
    INSERT OR REPLACE INTO storyReads(
      authorId,
      conversationId,
      storyId,
      storyReadDate
    ) VALUES (
      $authorId,
      $conversationId,
      $storyId,
      $storyReadDate
    );
    `).run(t)}function Wd(e,{authorId:t,conversationId:n,limit:r}){let i=r||5;return e.prepare(`
      SELECT * FROM storyReads
      WHERE
        authorId = $authorId AND
        ($conversationId IS NULL OR conversationId = $conversationId)
      ORDER BY storyReadDate DESC
      LIMIT $limit;
      `).all({authorId:t,conversationId:n||null,limit:i})}function Gd(e,t){return e.prepare(`
      SELECT count(1) FROM storyReads
      WHERE conversationId = $conversationId;
      `,{pluck:!0}).get({conversationId:t})??0}function Kd(e){return{...z(e,[`allowedMembersJson`,`scheduleDaysEnabledJson`]),emoji:e.emoji??void 0,allowAllCalls:!!e.allowAllCalls,allowAllMentions:!!e.allowAllMentions,scheduleEnabled:!!e.scheduleEnabled,allowedMembers:e.allowedMembersJson?new Set(JSON.parse(e.allowedMembersJson)):new Set,scheduleStartTime:e.scheduleStartTime||void 0,scheduleEndTime:e.scheduleEndTime||void 0,scheduleDaysEnabled:e.scheduleDaysEnabledJson?JSON.parse(e.scheduleDaysEnabledJson):void 0,deletedAtTimestampMs:e.deletedAtTimestampMs||void 0,storageID:e.storageID||void 0,storageVersion:e.storageVersion||void 0,storageNeedsSync:!!e.storageNeedsSync,storageUnknownFields:e.storageUnknownFields||void 0}}function qd(e){return{...z(e,[`allowedMembers`,`scheduleDaysEnabled`]),emoji:e.emoji||null,allowAllCalls:+!!e.allowAllCalls,allowAllMentions:+!!e.allowAllMentions,scheduleEnabled:+!!e.scheduleEnabled,allowedMembersJson:e.allowedMembers?JSON.stringify(Array.from(e.allowedMembers)):null,scheduleStartTime:e.scheduleStartTime||null,scheduleEndTime:e.scheduleEndTime||null,scheduleDaysEnabledJson:e.scheduleDaysEnabled?JSON.stringify(e.scheduleDaysEnabled):null,deletedAtTimestampMs:e.deletedAtTimestampMs||null,storageID:e.storageID||null,storageVersion:e.storageVersion||null,storageNeedsSync:+!!e.storageNeedsSync,storageUnknownFields:e.storageUnknownFields||null}}function Jd(e){return e.prepare(`SELECT * FROM notificationProfiles ORDER BY createdAtMs DESC;`).all().map(Kd)}function Yd(e,n){let[r,i]=t.mn`SELECT * FROM notificationProfiles WHERE id = ${n}`,a=e.prepare(r).get(i);if(a)return Kd(a)}function Xd(e){e.prepare(`DELETE FROM notificationProfiles;`).run()}function Zd(e,n){let[r,i]=t.mn`DELETE FROM notificationProfiles WHERE id = ${n}`;e.prepare(r).run(i)}function Qd(e,n){let r=new Date().getTime(),i=Yd(e,n);if(i&&i.deletedAtTimestampMs)return B.warn(`markNotificationProfileDeleted: Notification profile ${n} already had deletedAtTimestampMs set`),i.deletedAtTimestampMs;let[a,o]=t.mn`
      UPDATE notificationProfiles
      SET
        deletedAtTimestampMs = ${r},
        storageNeedsSync = 1
      WHERE
        id = ${n} AND
        deletedAtTimestampMs IS NULL
      RETURNING deletedAtTimestampMs`;return e.prepare(a).get(o)?.deletedAtTimestampMs}function $d(e,n){t.Ri(n.name,`Notification profile does not have a valid name`);let r=qd(n);e.prepare(`
      INSERT INTO notificationProfiles(
        id,
        name,
        emoji,
        color,
        createdAtMs,
        allowAllCalls,
        allowAllMentions,
        allowedMembersJson,
        scheduleEnabled,
        scheduleStartTime,
        scheduleEndTime,
        scheduleDaysEnabledJson,
        deletedAtTimestampMs,
        storageID,
        storageVersion,
        storageUnknownFields,
        storageNeedsSync
      ) VALUES (
        $id,
        $name,
        $emoji,
        $color,
        $createdAtMs,
        $allowAllCalls,
        $allowAllMentions,
        $allowedMembersJson,
        $scheduleEnabled,
        $scheduleStartTime,
        $scheduleEndTime,
        $scheduleDaysEnabledJson,
        $deletedAtTimestampMs,
        $storageID,
        $storageVersion,
        $storageUnknownFields,
        $storageNeedsSync
      );
      `).run(r)}function ef(e,n){t.Ri(n.name,`Notification profile does not have a valid name`),e.transaction(()=>{let t=qd(n);e.prepare(`
      UPDATE notificationProfiles SET
        name = $name,
        emoji = $emoji,
        color = $color,
        createdAtMs = $createdAtMs,
        allowAllCalls = $allowAllCalls,
        allowAllMentions = $allowAllMentions,
        allowedMembersJson = $allowedMembersJson,
        scheduleEnabled = $scheduleEnabled,
        scheduleStartTime = $scheduleStartTime,
        scheduleEndTime = $scheduleEndTime,
        scheduleDaysEnabledJson = $scheduleDaysEnabledJson,
        deletedAtTimestampMs = $deletedAtTimestampMs,
        storageID = $storageID,
        storageVersion = $storageVersion,
        storageUnknownFields = $storageUnknownFields,
        storageNeedsSync = $storageNeedsSync
      WHERE
        id = $id;
      `).run(t)})()}function tf(e){e.transaction(()=>{e.exec(`
      --- Remove messages delete trigger for performance
      DROP   TRIGGER messages_on_delete;

      DELETE FROM attachment_downloads;
      DELETE FROM attachment_backup_jobs;
      DELETE FROM attachment_downloads_backup_stats;
      DELETE FROM attachments_protected_from_deletion;
      DELETE FROM backup_cdn_object_metadata;
      DELETE FROM badgeImageFiles;
      DELETE FROM badges;
      DELETE FROM callLinks;
      DELETE FROM callsHistory;
      DELETE FROM chatFolders;
      DELETE FROM conversations;
      DELETE FROM defunctCallLinks;
      DELETE FROM donationReceipts;
      DELETE FROM groupCallRingCancellations;
      DELETE FROM groupSendCombinedEndorsement;
      DELETE FROM groupSendMemberEndorsement;
      DELETE FROM identityKeys;
      DELETE FROM items;
      DELETE FROM jobs;
      DELETE FROM key_transparency_account_data;
      DELETE FROM kyberPreKeys;
      DELETE FROM megaphones;
      DELETE FROM message_attachments;
      DELETE FROM messages_fts;
      DELETE FROM messages;
      DELETE FROM notificationProfiles;
      DELETE FROM pinnedMessages;
      DELETE FROM preKeys;
      DELETE FROM reactions;
      DELETE FROM recentEmojis;
      DELETE FROM recentGifs;
      DELETE FROM senderKeys;
      DELETE FROM sendLogMessageIds;
      DELETE FROM sendLogPayloads;
      DELETE FROM sendLogRecipients;
      DELETE FROM sessions;
      DELETE FROM signedPreKeys;
      DELETE FROM sticker_packs;
      DELETE FROM sticker_references;
      DELETE FROM stickers;
      DELETE FROM storyDistributionMembers;
      DELETE FROM storyDistributions;
      DELETE FROM storyReads;
      DELETE FROM syncTasks;
      DELETE FROM unprocessed;
      DELETE FROM uninstalled_sticker_packs;

      INSERT INTO messages_fts(messages_fts) VALUES('optimize');


      --- Re-create the messages delete trigger
      --- See migration 45
      CREATE TRIGGER messages_on_delete AFTER DELETE ON messages BEGIN
        DELETE FROM messages_fts WHERE rowid = old.rowid;
        DELETE FROM sendLogPayloads WHERE id IN (
          SELECT payloadId FROM sendLogMessageIds
          WHERE messageId = old.id
        );
        DELETE FROM reactions WHERE rowid IN (
          SELECT rowid FROM reactions
          WHERE messageId = old.id
        );
        DELETE FROM storyReads WHERE storyId = old.storyId;
      END;
    `),Au(e)})()}function nf(e,n){e.transaction(()=>{e.exec(`
      DELETE FROM attachment_backup_jobs;
      DELETE FROM attachment_downloads;
      DELETE FROM backup_cdn_object_metadata;
      DELETE FROM groupSendCombinedEndorsement;
      DELETE FROM groupSendMemberEndorsement;
      DELETE FROM jobs;
      DELETE FROM key_transparency_account_data;
      DELETE FROM kyberPreKeys;
      DELETE FROM preKeys;
      DELETE FROM senderKeys;
      DELETE FROM sendLogMessageIds;
      DELETE FROM sendLogPayloads;
      DELETE FROM sendLogRecipients;
      DELETE FROM sessions;
      DELETE FROM signedPreKeys;
      DELETE FROM syncTasks;
      DELETE FROM unprocessed;
      `);let r=e.prepare(`SELECT id FROM items`,{pluck:!0}).all(),a=new Set(i.at);n&&(a=a.union(new Set(i.ot)));for(let n of r)a.has(n)||t.fn(e,`items`,n);e.exec(`
        UPDATE storyDistributions SET senderKeyInfoJson = NULL;
      `);let[o,s]=t.mn`
      UPDATE conversations
      SET
        expireTimerVersion = ${1},
        json = json_remove(
          json,
          '$.senderKeyInfo',
          '$.storageID',
          '$.needsStorageServiceSync',
          '$.storageUnknownFields',
          '$.expireTimerVersion'
        );
    `;e.prepare(o).run(s)})()}function rf(e){e.exec(`
    -- Conversations
    UPDATE conversations
    SET
      json = json_remove(json, '$.storageID', '$.needsStorageServiceSync', '$.storageUnknownFields');

    -- Stickers
    UPDATE sticker_packs
    SET
      storageID = null,
      storageVersion = null,
      storageUnknownFields = null,
      storageNeedsSync = 0;

    UPDATE uninstalled_sticker_packs
    SET
      storageID = null,
      storageVersion = null,
      storageUnknownFields = null,
      storageNeedsSync = 0;

    -- Story Distribution Lists
    UPDATE storyDistributions
    SET
      storageID = null,
      storageVersion = null,
      storageUnknownFields = null,
      storageNeedsSync = 0;

    -- Call links
    UPDATE callLinks
    SET
      storageID = null,
      storageVersion = null,
      storageUnknownFields = null,
      storageNeedsSync = 0;

    -- Chat Folders
    UPDATE chatFolders
    SET
      storageID = null,
      storageVersion = null,
      storageUnknownFields = null,
      storageNeedsSync = 0;

    -- Notification Profiles
    UPDATE notificationProfiles
    SET
      storageID = null,
      storageVersion = null,
      storageUnknownFields = null,
      storageNeedsSync = 0;
  `)}function af(e,n,{maxVersion:r}){return e.transaction(()=>M(e,e.prepare(`
      SELECT ${t.Wt.join(`, `)}
      FROM messages
      WHERE
        (schemaVersion IS NULL OR schemaVersion < $maxVersion) AND
        IFNULL(
          json_extract(json, '$.schemaMigrationAttempts'),
          0
        ) < $maxAttempts
      LIMIT $limit;
      `).all({maxVersion:r,maxAttempts:5,limit:n})))()}function of(e,n){t.Xt(e,n,(n,r)=>{let[i,a]=t.mn`
        UPDATE
          messages
        SET
          json = json_set(
            json,
            '$.schemaMigrationAttempts',
            IFNULL(json -> '$.schemaMigrationAttempts', 0) + 1
          )
        WHERE
          id IN (${t.vn(n)})
      `;e.prepare(i,{persistent:r}).run(a)})}function sf(e,t,n){return n==null?e.prepare(`
    SELECT DISTINCT serverGuid
    FROM messages
    WHERE conversationId = $conversationId
    AND type IS NOT 'outgoing'
    AND serverGuid IS NOT NULL
    ORDER BY received_at DESC, sent_at DESC
    LIMIT $limit;
    `,{pluck:!0}).all({conversationId:t,limit:3}):e.prepare(`
    SELECT DISTINCT serverGuid
    FROM messages
    WHERE conversationId = $conversationId
    AND sourceServiceId = $sourceServiceId
    AND type IS NOT 'outgoing'
    AND serverGuid IS NOT NULL
    ORDER BY received_at DESC, sent_at DESC
    LIMIT $limit;
    `,{pluck:!0}).all({conversationId:t,sourceServiceId:n,limit:3})}function cf(e,t){let n=t,r=new Set,a=new Set,{messages:o,cursor:s}=uf(e,n);for(let e of o){let{externalAttachments:t,externalDownloads:n}=i.c(e);t.forEach(e=>r.add(e)),n.forEach(e=>a.add(e))}return{attachments:Array.from(r),downloads:Array.from(a),cursor:s}}function lf(e,t){df(e,t)}function uf(e,n){let r=$o(e,`only temp table use`),i=1e3;return r.transaction(()=>{let a=n?.count??0;t.Ri(!n?.done,`pageMessages: iteration cannot be restarted`);let s;if(n===void 0){s=(0,o.randomBytes)(8).toString(`hex`);let t=vc(e);B.info(`pageMessages(${s}): Starting iteration through ${t} messages`),r.exec(`
        CREATE TEMP TABLE tmp_${s}_updated_messages
          (rowid INTEGER PRIMARY KEY, received_at INTEGER, sent_at INTEGER);

        CREATE INDEX tmp_${s}_updated_messages_received_at
          ON tmp_${s}_updated_messages (received_at ASC, sent_at ASC);

        INSERT INTO tmp_${s}_updated_messages
          (rowid, received_at, sent_at)
          SELECT rowid, received_at, sent_at FROM messages
          ORDER BY received_at ASC, sent_at ASC;

        CREATE TEMP TRIGGER tmp_${s}_message_updates
        UPDATE OF json ON messages
        BEGIN
          INSERT OR IGNORE INTO tmp_${s}_updated_messages
          (rowid, received_at, sent_at)
          VALUES (NEW.rowid, NEW.received_at, NEW.sent_at);
        END;

        CREATE TEMP TRIGGER tmp_${s}_message_inserts
        AFTER INSERT ON messages
        BEGIN
          INSERT OR IGNORE INTO tmp_${s}_updated_messages
          (rowid, received_at, sent_at)
          VALUES (NEW.rowid, NEW.received_at, NEW.sent_at);
        END;
        `)}else ({runId:s}=n);let c=r.prepare(`
      DELETE FROM tmp_${s}_updated_messages
      RETURNING rowid
      ORDER BY received_at ASC, sent_at ASC
      LIMIT $chunkSize;
    `,{pluck:!0}).all({chunkSize:i}),l=t.Xt(r,c,(n,i)=>M(e,r.prepare(`
          SELECT ${t.Wt.join(`, `)}
          FROM messages
          WHERE rowid IN (${Array(n.length).fill(`?`).join(`,`)});
          `,{persistent:i}).all(n)));a+=l.length;let u=c.length<i;return{messages:l,cursor:{runId:s,count:a,done:u}}})()}function df(e,{runId:t,count:n,done:r}){let i=$o(e,`only temp table use`),a=`finishPageMessages(${t})`;r||B.warn(`${a}: iteration not finished`),B.info(`${a}: reached the end after processing ${n} messages`),i.exec(`
    DROP TABLE tmp_${t}_updated_messages;
    DROP TRIGGER tmp_${t}_message_updates;
    DROP TRIGGER tmp_${t}_message_inserts;
  `)}function ff(e,n){let r=1e3,[i,a]=t.mn`
    SELECT
      rowid,
      ${t.Gt}
    FROM messages
    WHERE
      rowid >= ${n?.nextRowid??0}
    LIMIT ${r}
  `,o=e.prepare(i).all(a);return{cursor:{nextRowid:o.at(-1)?.rowid??0,done:o.length<r},messages:M(e,o)}}function pf(e){let t=[],n=As(e,`backupDownloadPath`);return n&&t.push(n.value),t}function mf(e){let n=new Set,r=!1,a=``,o=ac(e);B.info(`getKnownConversationAttachments: About to iterate through ${o}`);let s=e.prepare(`
      SELECT json FROM conversations
      WHERE id > $id
      ORDER BY id ASC
      LIMIT $chunkSize;
    `);for(;!r;){let e=jo(s.all({id:a,chunkSize:500}),e=>t.ln(e.json));e.forEach(e=>{i.i(e).forEach(e=>n.add(e))});let o=Ao(e);o&&({id:a}=o),r=e.length<500}return B.info(`getKnownConversationAttachments: Done processing`),Array.from(n)}function hf(e,t){let n=To(jo(t,e=>[e,!0])),r=od(e);B.info(`removeKnownStickers: About to iterate through ${r} stickers`);let i=0,a=!1,o=0;for(;!a;){let t=e.prepare(`
        SELECT rowid, path FROM stickers
        WHERE rowid > $rowid
        ORDER BY rowid ASC
        LIMIT $chunkSize;
        `).all({rowid:o,chunkSize:50});t.map(e=>e.path).forEach(e=>{delete n[e]});let r=Ao(t);r&&({rowid:o}=r),a=t.length<50,i+=t.length}return B.info(`removeKnownStickers: Done processing ${i} stickers`),Object.keys(n)}function gf(e,n){let r=To(jo(n,e=>[e,!0])),a=ac(e);B.info(`removeKnownDraftAttachments: About to iterate through ${a} conversations`);let o=!1,s=0,c=0;for(;!o;){let n=e.prepare(`
        SELECT json FROM conversations
        WHERE id > $id
        ORDER BY id ASC
        LIMIT $chunkSize;
        `).all({id:c,chunkSize:50}).map(e=>t.ln(e.json));n.forEach(e=>{i.a(e).forEach(e=>{delete r[e]})});let a=Ao(n);a&&({id:c}=a),o=n.length<50,s+=n.length}return B.info(`removeKnownDraftAttachments: Done processing ${s} conversations`),Object.keys(r)}function _f(e,n){return e.prepare(`
      SELECT id, timestamp, data
      FROM jobs
      WHERE queueType = $queueType
      ORDER BY timestamp;
      `).all({queueType:n}).map(e=>({id:e.id,queueType:n,timestamp:e.timestamp,data:t._a(e.data)?JSON.parse(e.data):void 0}))}function X(e,n){e.prepare(`
      INSERT INTO jobs
      (id, queueType, timestamp, data)
      VALUES
      ($id, $queueType, $timestamp, $data);
    `).run({id:n.id,queueType:n.queueType,timestamp:n.timestamp,data:t._a(n.data)?JSON.stringify(n.data):null})}function vf(e,t){e.prepare(`DELETE FROM jobs WHERE id = $id`).run({id:t})}function yf(e,t){return e.prepare(`
  SELECT EXISTS (
    SELECT 1 FROM groupCallRingCancellations
    WHERE ringId = $ringId
    AND createdAt >= $ringsOlderThanThisAreIgnored
  );
  `,{pluck:!0,bigint:!0}).get({ringId:t,ringsOlderThanThisAreIgnored:Date.now()-xf})===1n}function bf(e,t){e.prepare(`
    INSERT INTO groupCallRingCancellations (ringId, createdAt)
    VALUES ($ringId, $createdAt)
    ON CONFLICT (ringId) DO NOTHING;
    `,{bigint:!0}).run({ringId:t,createdAt:Date.now()})}const xf=30*t.In;function Sf(e){e.prepare(`
    DELETE FROM groupCallRingCancellations
    WHERE createdAt < $expiredRingTime;
    `).run({expiredRingTime:Date.now()-xf})}function Cf(e){return e.prepare(`
SELECT MAX(counter)
FROM
  (
    SELECT MAX(received_at) AS counter FROM messages
    UNION
    SELECT MAX(timestamp) AS counter FROM unprocessed
  )
`,{pluck:!0}).get()}function wf(e){return Mo({messageCount:vc(e),conversationCount:ac(e),sessionCount:t.rn(e,`sessions`),senderKeyCount:t.rn(e,`senderKeys`)},i.cr)}function Tf(e,t,n){e.prepare(`
    UPDATE conversations
    SET json = JSON_PATCH(json, $patch);
    `).run({patch:JSON.stringify({conversationColor:t||null,customColor:n?.value||null,customColorId:n?.id||null})})}function Ef(e){e.exec(`
    UPDATE conversations
    SET
      json = json_remove(json, '$.profileKeyCredential')
    `)}function Df(e,n,r,i){e.transaction(()=>{zc(e,n,{ourAci:r,alreadyInTransaction:!0});try{for(let{conversationId:n,messageId:r,readStatus:a,sentAt:o}of i){let[i,s]=t.mn`
        INSERT INTO edited_messages (
          conversationId,
          messageId,
          sentAt,
          readStatus
        ) VALUES (
          ${n},
          ${r},
          ${o},
          ${a??null}
        );
      `;e.prepare(i).run(s)}}catch(r){let[i,a]=t.mn`
        SELECT EXISTS(
          SELECT 1 FROM messages
          WHERE messages.id = ${n.id}
        );
      `;if(e.prepare(i,{pluck:!0}).get(a)!==1)B.warn(`saveEditedMessages: save failed because message does not exist`);else throw r}})()}function Of(e,t,n,r){return Df(e,t,n,[r])}function kf(e){return e.prepare(`
      SELECT * FROM edited_messages;
      `).all({})}function Af(e,{conversationId:n,readMessageReceivedAt:r}){return e.transaction(()=>{let[a,o]=t.mn`
      SELECT
        ${t.vn(t.Wt.filter(e=>e!==`sent_at`&&e!==`readStatus`).map(e=>t.gn`messages.${t._n(e)}`))},
        edited_messages.sentAt as sent_at,
        edited_messages.readStatus
      FROM edited_messages
      JOIN messages
        ON messages.id = edited_messages.messageId
      WHERE
        edited_messages.readStatus = ${i.nt.Unread} AND
        edited_messages.conversationId = ${n} AND
        messages.received_at <= ${r}
      ORDER BY messages.received_at DESC, messages.sent_at DESC;
    `,s=e.prepare(a).all(o),[c]=s;if(c!=null){let r=c.sent_at,[a,o]=t.mn`
        UPDATE edited_messages
          SET
            readStatus = ${i.nt.Read}
          WHERE
            readStatus = ${i.nt.Unread} AND
            conversationId = ${n} AND
            sentAt <= ${r};
      `;e.prepare(a).run(o)}return M(e,s).map(e=>({originalReadStatus:e.readStatus??void 0,readStatus:i.nt.Read,seenStatus:i.w.Seen,...Fo(e,[`conversationId`,`expirationStartTimestamp`,`id`,`received_at`,`sent_at`,`source`,`sourceServiceId`,`timestamp`,`type`])}))})()}function jf(e){let[n,r]=t.mn`
    SELECT schemaVersion, COUNT(1) as count from messages
    GROUP BY schemaVersion;
  `;return e.prepare(n).all(r).sort((e,t)=>e.schemaVersion-t.schemaVersion)}function Mf(e,n){return e.transaction(()=>{let[r,i]=t.mn`
      SELECT * from messages
      WHERE schemaVersion = ${n}
      ORDER BY RANDOM()
      LIMIT 2;
    `;return M(e,e.prepare(r).all(i))})()}function Nf(e){e.transaction(()=>{ks(e,{id:`messageInsertTriggersDisabled`,value:!0}),e.exec(`DROP TRIGGER IF EXISTS messages_on_insert;`),e.exec(`DROP TRIGGER IF EXISTS messages_on_insert_insert_mentions;`)})()}const Pf=`
  SELECT messages.id, bodyRanges.value ->> 'mentionAci' as mentionAci,
    bodyRanges.value ->> 'start' as start,
    bodyRanges.value ->> 'length' as length
  FROM messages, json_each(messages.json ->> 'bodyRanges') as bodyRanges
  WHERE bodyRanges.value ->> 'mentionAci' IS NOT NULL
`;function Ff(e){e.pragma(`checkpoint_fullfsync = false`),e.pragma(`synchronous = OFF`)}function If(e){e.pragma(`checkpoint_fullfsync = true`),e.pragma(`synchronous = FULL`),e.pragma(`wal_checkpoint(FULL)`)}function Lf(e){e.transaction(()=>{zf(e),Rf(e),e.exec(`DROP TRIGGER IF EXISTS messages_on_insert`),e.exec(In),e.exec(`DROP TRIGGER IF EXISTS messages_on_insert_insert_mentions`),e.exec(`
      CREATE TRIGGER messages_on_insert_insert_mentions AFTER INSERT ON messages
      BEGIN
        INSERT INTO mentions (messageId, mentionAci, start, length)
        ${Pf}
        AND messages.id = new.id;
      END;
    `),ks(e,{id:`messageInsertTriggersDisabled`,value:!1})})()}function Rf(e){e.exec(`
    DELETE FROM messages_fts;
    INSERT OR REPLACE INTO messages_fts (rowid, body)
      SELECT rowid, searchableText
      FROM messages
      WHERE isSearchable = 1;
  `)}function zf(e){e.exec(`
    DELETE FROM mentions;
    INSERT INTO mentions (messageId, mentionAci, start, length)
    ${Pf};
  `)}function Bf(e){e.transaction(()=>{As(e,`messageInsertTriggersDisabled`)?.value&&(B.warn(`Message insert triggers were disabled; reenabling and backfilling data`),Lf(e))})()}function Vf(e,t){let n;try{e.pragma(`query_only = on`),n=e.prepare(t).all()}finally{e.pragma(`query_only = off`)}return n}if(!u.parentPort)throw Error(`Must run as a worker thread`);const Hf=u.parentPort;function Z(e,t){let n={type:`response`,seq:e,error:void 0,errorKind:void 0,response:t};Hf.postMessage(n)}let Q,$=!1,Uf=!1;const Wf=({seq:e,request:t},n=!1)=>{try{if(t.type===`init`){$=t.isPrimary,Uf=!1,$&&L.setOnCheckpointNeeded(e=>{let t={type:`walCheckpointNeeded`,reason:e};Hf.postMessage(t)}),Q=Jo({...t.options,isPrimary:$}),Z(e,void 0);return}if(Uf&&t.type===`close`){Z(e,void 0),process.exit(0);return}if(t.type===`removeDB`){try{Q&&=($?Ro.close(Q):Lo.close(Q),void 0)}catch{So.error(`Failed to close database before removal`)}$&&Zo(),Uf=!0,Z(e,void 0);return}if(!Q)throw Error(`Not initialized`);if(t.type===`close`){$?Ro.close(Q):Lo.close(Q),Q=void 0,Z(e,void 0),process.exit(0);return}if(t.type===`walCheckpoint`){Q!=null&&L.runImmediately(Q,So,t.reason),Z(e,void 0);return}if(t.type===`sqlCall:read`||t.type===`sqlCall:write`){let n=(t.type===`sqlCall:read`?Lo:Ro)[t.method];if(typeof n!=`function`)throw Error(`Invalid sql method: ${t.method} ${n}`);let r=t.encoding===`js`?t.args:(0,d.deserialize)(t.data),i=performance.now(),a=n(Q,...r),o=performance.now()-i;Z(e,{result:t.encoding===`js`?a:(0,d.serialize)(a),duration:o})}else throw Error(`Unexpected request type`)}catch(i){let a=r.n(i);if((a===r.t.Corrupted||a===r.t.Logic)&&Q!=null&&Ro.runCorruptionChecks(Q)&&!n&&(t.type===`sqlCall:read`||t.type===`sqlCall:write`))return So.error(`Retrying request: ${t.type}`),Wf({seq:e,request:t},!0);let o={type:`response`,seq:e,error:{name:i.name,message:i.message,stack:i.stack},errorKind:a,response:void 0};Hf.postMessage(o)}};Hf.on(`message`,e=>Wf(e));
//# sourceURL=bundles:///workers/sql.js