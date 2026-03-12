<%@ page import="org.springframework.samples.petclinic.web.legacy.LegacyOwnerConsoleAdapter" %>
<%
  String consoleToken = new LegacyOwnerConsoleAdapter().loadOwnerConsole("Davis");
%>
<div class="legacy-owner-console">
  <h2>Legacy Owner Console</h2>
  <p data-token="<%= consoleToken %>">Virtual page sample with an adapter-backed Java chain.</p>
</div>
