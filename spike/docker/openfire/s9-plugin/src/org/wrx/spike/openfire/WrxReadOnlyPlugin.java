package org.wrx.spike.openfire;

import java.io.File;
import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;

import org.jivesoftware.openfire.XMPPServer;
import org.jivesoftware.openfire.container.Plugin;
import org.jivesoftware.openfire.container.PluginManager;
import org.jivesoftware.openfire.interceptor.InterceptorManager;
import org.jivesoftware.openfire.interceptor.PacketInterceptor;
import org.jivesoftware.openfire.interceptor.PacketRejectedException;
import org.jivesoftware.openfire.session.Session;
import org.jivesoftware.util.JiveGlobals;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.xmpp.packet.Message;
import org.xmpp.packet.Packet;
import org.xmpp.packet.PacketError;

/**
 * S9 escape-hatch sketch (SPIKE-BRIEF S9). "Hello world" = the log line in initializePlugin.
 * Read-only sketch: a PacketInterceptor that rejects groupchat messages sent to the MUC service by
 * bare JIDs listed in the system property wrx.readonly.jids (comma separated), answering with a
 * forbidden error, independent of room roles or moderators.
 */
public class WrxReadOnlyPlugin implements Plugin, PacketInterceptor {
    private static final Logger Log = LoggerFactory.getLogger(WrxReadOnlyPlugin.class);

    @Override
    public void initializePlugin(PluginManager manager, File pluginDirectory) {
        Log.info("WRX1 hello world: plugin loaded from {}", pluginDirectory);
        InterceptorManager.getInstance().addInterceptor(this);
    }

    @Override
    public void destroyPlugin() {
        InterceptorManager.getInstance().removeInterceptor(this);
        Log.info("WRX1 hello world: plugin unloaded");
    }

    private static Set<String> readOnly() {
        // System property (admin console) or, for the isolated S9 test stack, an environment variable.
        String fallback = System.getenv().getOrDefault("WRX_READONLY_JIDS", "");
        return Arrays.stream(JiveGlobals.getProperty("wrx.readonly.jids", fallback).split(","))
            .map(String::trim).filter(s -> !s.isEmpty()).collect(Collectors.toSet());
    }

    @Override
    public void interceptPacket(Packet packet, Session session, boolean incoming, boolean processed)
        throws PacketRejectedException {
        if (!incoming || processed || !(packet instanceof Message)) return;
        Message m = (Message) packet;
        if (m.getType() != Message.Type.groupchat || m.getTo() == null || m.getFrom() == null) return;
        String mucDomain = "conference." + XMPPServer.getInstance().getServerInfo().getXMPPDomain();
        if (!mucDomain.equals(m.getTo().getDomain())) return;
        if (!readOnly().contains(m.getFrom().toBareJID())) return;
        Log.info("WRX1 read-only: rejecting groupchat from {} to {}", m.getFrom(), m.getTo());
        // Bounce an error to the sender ourselves; PacketRejectedException alone only drops the stanza.
        Message error = m.createCopy();
        error.setTo(m.getFrom());
        error.setFrom(m.getTo());
        error.setError(new PacketError(PacketError.Condition.forbidden, PacketError.Type.auth,
            "Read-only role: posting is not allowed (WRX1 plugin)."));
        XMPPServer.getInstance().getPacketRouter().route(error);
        throw new PacketRejectedException("read-only role");
    }
}
