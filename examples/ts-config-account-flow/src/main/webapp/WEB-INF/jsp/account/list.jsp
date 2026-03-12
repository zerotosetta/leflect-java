<%@ page contentType="text/html; charset=UTF-8" %>
<%@ page import="com.acme.account.AccountController" %>
<%@ include file="/WEB-INF/jsp/common/header.jsp" %>
<%
String accountId = request.getParameter("accountId");
String balance = new com.acme.account.AccountController().loadAccount(accountId);
%>
<div class="balance"><%= balance %></div>
